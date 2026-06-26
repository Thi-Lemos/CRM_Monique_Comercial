import { Parceiro } from '../types';

export function calculateCriteriaNotes(parceiro: Partial<Parceiro>) {
  // N1: Volume total mensal
  let n1 = 1;
  const volTotal = parceiro.vol_total_mensal || 0;
  if (volTotal <= 30000) n1 = 1;
  else if (volTotal <= 80000) n1 = 3;
  else if (volTotal <= 150000) n1 = 5;
  else if (volTotal <= 300000) n1 = 7;
  else n1 = 9;

  // N2: Concentração atual
  let n2 = 1;
  const conc = volTotal > 0 ? ((parceiro.vol_prata_mensal || 0) / volTotal) * 100 : 0;
  if (conc < 10) n2 = 1;
  else if (conc <= 20) n2 = 3;
  else if (conc <= 30) n2 = 5;
  else if (conc <= 50) n2 = 7;
  else n2 = 9;

  // N3: Estrutura (Nº vendedores)
  let n3 = 1;
  const vend = parceiro.num_vendedores || 0;
  if (vend <= 1) n3 = 1;
  else if (vend <= 3) n3 = 3;
  else if (vend <= 5) n3 = 5;
  else if (vend <= 10) n3 = 7;
  else n3 = 9;

  // N4: Abrangência
  let n4 = 1;
  const abr = parceiro.area_geografica || 'Local';
  if (abr === 'Local') n4 = 1;
  else if (abr === 'Regional') n4 = 4;
  else if (abr === 'Estadual') n4 = 6;
  else if (abr === 'Nacional') n4 = 9;

  // N5: Produtos ativos no Prata
  let n5 = 1;
  const prodCount = (parceiro.produtos_ativos || []).length;
  if (prodCount === 0) n5 = 1;
  else if (prodCount === 1) n5 = 3;
  else if (prodCount === 2) n5 = 5;
  else if (prodCount === 3) n5 = 7;
  else n5 = 9;

  // N6: Modelo de atuação
  let n6 = 1;
  const mod = parceiro.modelo_atuacao || 'Físico';
  if (mod === 'Físico') n6 = 1;
  else if (mod === 'Pastinhas') n6 = 3;
  else if (mod === 'Híbrido') n6 = 6;
  else if (mod === 'Digital') n6 = 9;

  // N7: Risco de dependência (diversificação)
  // 1 produto = alto risco (1), 2 produtos (5), 3 produtos (7), 4 produtos (9)
  let n7 = 1;
  if (prodCount <= 1) n7 = 1;
  else if (prodCount === 2) n7 = 5;
  else if (prodCount === 3) n7 = 7;
  else n7 = 9;

  return { n1, n2, n3, n4, n5, n6, n7 };
}

export function calculateScoreAndClassification(parceiro: Partial<Parceiro>, config?: any): {
  score: number;
  classificacao: 'Estratégico' | 'Crescimento' | 'Reativação' | 'Prospecção';
} {
  const { n1, n2, n3, n4, n5, n6, n7 } = calculateCriteriaNotes(parceiro);

  const pesos = config?.pesos_score || {
    vol_total: 25,
    concentracao: 20,
    num_vendedores: 15,
    area_geografica: 15,
    produtos_ativos: 10,
    modelo_atuacao: 10,
    diversificacao: 5
  };

  const score = ((n1 * pesos.vol_total) + 
                 (n2 * pesos.concentracao) + 
                 (n3 * pesos.num_vendedores) + 
                 (n4 * pesos.area_geografica) + 
                 (n5 * pesos.produtos_ativos) + 
                 (n6 * pesos.modelo_atuacao) + 
                 (n7 * pesos.diversificacao)) / 10;
  
  // Garantir limites
  const scoreFinal = Math.max(0, Math.min(100, Math.round(score * 10) / 10)); // arredondado a 1 decimal
  
  let classificacao: 'Estratégico' | 'Crescimento' | 'Reativação' | 'Prospecção' = 'Prospecção';
  const status = parceiro.status || 'Em prospecção';
  
  if (status === 'Ativo') {
    if (scoreFinal >= 80) {
      classificacao = 'Estratégico';
    } else {
      classificacao = 'Crescimento';
    }
  } else if (status === 'Inativo' || status === 'Em reativação') {
    classificacao = 'Reativação';
  } else {
    classificacao = 'Prospecção';
  }

  return {
    score: scoreFinal,
    classificacao
  };
}
