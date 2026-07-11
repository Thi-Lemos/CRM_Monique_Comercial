import { Parceiro } from '../types';

export function calculateCriteriaNotes(parceiro: Partial<Parceiro>, config?: any) {
  // Faixas configuráveis (com fallback para os valores padrão de fábrica)
  const volFaixas: [number, number, number, number] =
    config?.score_notas?.vol_total_faixas ?? [30000, 80000, 150000, 300000];
  const concFaixas: [number, number, number, number] =
    config?.score_notas?.concentracao_faixas ?? [10, 20, 30, 50];
  const vendFaixas: [number, number, number, number] =
    config?.score_notas?.vendedores_faixas ?? [1, 3, 5, 10];

  // N1: Volume total mensal
  let n1 = 1;
  const volTotal = parceiro.vol_total_mensal || 0;
  if (volTotal <= volFaixas[0]) n1 = 1;
  else if (volTotal <= volFaixas[1]) n1 = 3;
  else if (volTotal <= volFaixas[2]) n1 = 5;
  else if (volTotal <= volFaixas[3]) n1 = 7;
  else n1 = 9;

  // N2: Concentração atual
  let n2 = 1;
  const volTotalSeguro = Math.max(volTotal, parceiro.vol_prata_mensal || 0);
  const conc = volTotalSeguro > 0 ? ((parceiro.vol_prata_mensal || 0) / volTotalSeguro) * 100 : 0;
  if (conc < concFaixas[0]) n2 = 1;
  else if (conc <= concFaixas[1]) n2 = 3;
  else if (conc <= concFaixas[2]) n2 = 5;
  else if (conc <= concFaixas[3]) n2 = 7;
  else n2 = 9;

  // N3: Estrutura (Nº vendedores)
  let n3 = 1;
  const vend = parceiro.num_vendedores || 0;
  if (vend <= vendFaixas[0]) n3 = 1;
  else if (vend <= vendFaixas[1]) n3 = 3;
  else if (vend <= vendFaixas[2]) n3 = 5;
  else if (vend <= vendFaixas[3]) n3 = 7;
  else n3 = 9;

  // N4: Abrangência (categorias fixas)
  let n4 = 1;
  const abr = parceiro.area_geografica || 'Local';
  if (abr === 'Local') n4 = 1;
  else if (abr === 'Regional') n4 = 4;
  else if (abr === 'Estadual') n4 = 6;
  else if (abr === 'Nacional') n4 = 9;

  // N5: Produtos ativos no Prata (categorias fixas por contagem)
  let n5 = 1;
  const prodCount = (parceiro.produtos_ativos || []).length;
  if (prodCount === 0) n5 = 1;
  else if (prodCount === 1) n5 = 3;
  else if (prodCount === 2) n5 = 5;
  else if (prodCount === 3) n5 = 7;
  else n5 = 9;

  // N6: Modelo de atuação (categorias fixas)
  let n6 = 1;
  const mod = parceiro.modelo_atuacao || 'Físico';
  if (mod === 'Físico') n6 = 1;
  else if (mod === 'Pastinhas') n6 = 3;
  else if (mod === 'Híbrido') n6 = 6;
  else if (mod === 'Digital') n6 = 9;

  // N7: Risco de dependência / diversificação (categorias fixas por contagem)
  let n7 = 1;
  if (prodCount <= 1) n7 = 1;
  else if (prodCount === 2) n7 = 5;
  else if (prodCount === 3) n7 = 7;
  else n7 = 9;

  return { n1, n2, n3, n4, n5, n6, n7 };
}

export function calculateScoreAndClassification(parceiro: Partial<Parceiro>, config?: any): {
  score: number;
  classificacao: 'Estratégico' | 'Crescimento' | 'Desenvolvimento';
} {
  const { n1, n2, n3, n4, n5, n6, n7 } = calculateCriteriaNotes(parceiro, config);

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
  
  const scoreFinal = Math.max(0, Math.min(100, Math.round(score * 10) / 10));

  // Limiares configuráveis (com fallback para os valores padrão)
  const limiarEstrategico = config?.score_thresholds?.estrategico ?? 70;
  const limiarCrescimento = config?.score_thresholds?.crescimento ?? 40;

  let classificacao: 'Estratégico' | 'Crescimento' | 'Desenvolvimento' = 'Desenvolvimento';
  
  if (scoreFinal >= limiarEstrategico) {
    classificacao = 'Estratégico';
  } else if (scoreFinal >= limiarCrescimento) {
    classificacao = 'Crescimento';
  }

  return {
    score: scoreFinal,
    classificacao
  };
}
