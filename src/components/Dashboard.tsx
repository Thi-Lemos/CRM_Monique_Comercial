import { useEffect, useState } from 'react';
import { dataService, getMonthsForPeriod, getPeriodLabel, getDefaultPeriod, getPeriodOptions, shiftMonth, getMonthShortLabel, computeStatusTimeline, computeStatusAtMonth, getCurrentPeriodRef } from '../services/dataService';
import { Parceiro, SemafaroStatus, CrmLog, ProducaoMensal, CriteriosConfig, EventoSemana } from '../types';
import { NOMES_MESES } from '../utils/weekUtils';
import ExcelImporter from './ExcelImporter';
import { 
  TrendingUp, 
  Users, 
  Percent, 
  Briefcase,
  Layers,
  AlertCircle,
  Upload,
  PieChart,
  X
} from 'lucide-react';


function gerarAlertasDinamicos(pList: Parceiro[], lList: CrmLog[], allProds: ProducaoMensal[]) {
  const activeAlerts: any[] = [];
  const hoje = new Date();

  // Mês de referência = mês fechado mais recente (mês imediatamente anterior ao
  // atual, presumido completo). Mês de comparação = mês anterior a esse.
  // Calculados dinamicamente a partir da data real do sistema — não ficam mais
  // presos a um mês/ano fixo no código.
  const anoAtualNum = hoje.getFullYear();
  const mesAtualNum = hoje.getMonth() + 1;
  const mesRef = shiftMonth(anoAtualNum, mesAtualNum, -1);
  const mesComparacao = shiftMonth(anoAtualNum, mesAtualNum, -2);
  const labelMesRef = getMonthShortLabel(mesRef.ano, mesRef.mes);
  const labelMesComparacao = getMonthShortLabel(mesComparacao.ano, mesComparacao.mes);

  const prodsMap: { [key: string]: ProducaoMensal[] } = {};
  for (const prod of allProds) {
    if (!prodsMap[prod.parceiro_id]) {
      prodsMap[prod.parceiro_id] = [];
    }
    prodsMap[prod.parceiro_id].push(prod);
  }

  // Faturamento consolidado total no mês de referência (mês fechado mais recente)
  const faturamentoTotalPrataRef = pList.reduce((sum, p) => {
    const prods = prodsMap[p.id] || [];
    const prRef = prods.find(pr => pr.ano === mesRef.ano && pr.mes === mesRef.mes);
    const vol = prRef ? (prRef.vol_fgts || 0) + (prRef.vol_clt || 0) + (prRef.vol_cgv || 0) + (prRef.vol_pix || 0) : 0;
    return sum + vol;
  }, 0) || 1;

  for (const p of pList) {
    const logsParceiro = lList.filter(l => l.parceiro_id === p.id);
    const dataUltima = logsParceiro.length > 0 
      ? new Date(logsParceiro[0].data_contato) 
      : null;
    
    const producoes = prodsMap[p.id] || [];
    const prodRef = producoes.find(pr => pr.ano === mesRef.ano && pr.mes === mesRef.mes);
    const volPrataRef = prodRef ? (prodRef.vol_fgts || 0) + (prodRef.vol_clt || 0) + (prodRef.vol_cgv || 0) + (prodRef.vol_pix || 0) : 0;

    // Alerta A: Risco de Concentração Sistêmica (usando dados do mês de referência)
    const sharePortfol = (volPrataRef / faturamentoTotalPrataRef) * 100;
    if (p.status === 'Ativo' && sharePortfol >= 30) {
      activeAlerts.push({
        id: 'alert_conc_sist_' + p.id,
        parceiro: p.nome,
        parceiroId: p.id,
        mensagem: `Risco de Concentração Sistêmica (Ref: ${labelMesRef}): O parceiro representou ${sharePortfol.toFixed(1)}% do faturamento consolidado do Prata Digital no mês anterior.`,
        prioridade: 'Alta',
        ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem registro',
        data_criacao: hoje
      });
    }

    // Alerta B: Queda Consolidada (comparando o mês de referência com o mês anterior, ambos fechados)
    const prodComparacao = producoes.find(pr => pr.ano === mesComparacao.ano && pr.mes === mesComparacao.mes);
    
    if (p.status === 'Ativo' && prodRef && prodComparacao) {
      const volComparacao = (prodComparacao.vol_fgts || 0) + (prodComparacao.vol_clt || 0) + (prodComparacao.vol_cgv || 0) + (prodComparacao.vol_pix || 0);
      
      if (volComparacao > 0) {
        const queda = ((volComparacao - volPrataRef) / volComparacao) * 100;
        if (queda >= 40) {
          activeAlerts.push({
            id: 'alert_early_warn_' + p.id,
            parceiro: p.nome,
            parceiroId: p.id,
            mensagem: `Redução de ${queda.toFixed(1)}% no faturamento consolidado de ${labelMesRef} em relação a ${labelMesComparacao} (de R$ ${volComparacao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} para R$ ${volPrataRef.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).`,
            prioridade: 'Alta',
            ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem registro',
            data_criacao: hoje
          });
        }
      }
    }

    // Regra 1: Parceiro Estratégico sem contato há mais de 30 dias (apenas se cadastrado há mais de 30 dias)
    if (p.classificacao === 'Estratégico' && p.status === 'Ativo') {
      const dataCriacao = p.created_at ? new Date(p.created_at) : new Date();
      const diferencaCriacaoDias = (hoje.getTime() - dataCriacao.getTime()) / (1000 * 60 * 60 * 24);
      if (diferencaCriacaoDias > 30) {
        if (!dataUltima || (hoje.getTime() - dataUltima.getTime()) > (30 * 24 * 60 * 60 * 1000)) {
          activeAlerts.push({
            id: 'alert_strat_' + p.id,
            parceiro: p.nome,
            parceiroId: p.id,
            mensagem: 'Parceiro Estratégico sem nenhum contato registrado nos últimos 30 dias.',
            prioridade: 'Alta',
            ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem registro',
            data_criacao: hoje
          });
        }
      }
    }

    // Regra 2: Novo parceiro (Onboarding) sem nenhuma operação/volume em 7 dias após criação
    if (p.status === 'Onboarding') {
      const dataCriacao = p.created_at ? new Date(p.created_at) : new Date();
      if ((hoje.getTime() - dataCriacao.getTime()) > (7 * 24 * 60 * 60 * 1000) && p.vol_prata_mensal === 0) {
        activeAlerts.push({
          id: 'alert_new_' + p.id,
          parceiro: p.nome,
          parceiroId: p.id,
          mensagem: 'Novo parceiro cadastrado há mais de 7 dias sem registrar nenhuma operação.',
          prioridade: 'Alta',
          ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem contato',
          data_criacao: hoje
        });
      }
    }


    // Regra 3: Parceiro Inativo com histórico real de produção (queda, não ausência
    // desde sempre) e inatividade de 60+ dias desde a última produção válida.
    // Usa o histórico real de produção (allProds), não mais vol_total_mensal — esse
    // campo é autodeclarado no cadastro e raramente atualizado, o que fazia o alerta
    // deixar de disparar para a maioria dos parceiros em Inativo mesmo com histórico.
    if (p.status === 'Inativo') {
      const sortedProds = [...producoes].sort((a, b) => (b.ano !== a.ano ? b.ano - a.ano : b.mes - a.mes));
      const ultimaProd = sortedProds.find(pr => {
        const vol = (pr.vol_fgts || 0) + (pr.vol_clt || 0) + (pr.vol_cgv || 0) + (pr.vol_pix || 0);
        return vol > 0;
      });

      if (ultimaProd) {
        const dataUltimaProd = new Date(ultimaProd.ano, ultimaProd.mes, 0);
        const diasSemProducao = (hoje.getTime() - dataUltimaProd.getTime()) / (1000 * 60 * 60 * 24);

        if (diasSemProducao >= 60) {
          activeAlerts.push({
            id: 'alert_inactive_' + p.id,
            parceiro: p.nome,
            parceiroId: p.id,
            mensagem: 'Produção zerada há 60+ dias — processo Win-back deve ser iniciado.',
            prioridade: 'Alta',
            ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem registro',
            data_criacao: hoje
          });
        }
      }
    }

    // Oportunidades (Prioridade Média)
    if (p.status === 'Ativo' && !(p.produtos_ativos || []).includes('CGV') && (p.num_vendedores || 0) >= 4) {
      activeAlerts.push({
        id: 'alert_opp_cgv_' + p.id,
        parceiro: p.nome,
        parceiroId: p.id,
        mensagem: 'Parceiro qualificado para expansão do produto CGV (ainda não ativado).',
        prioridade: 'Média',
        ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem registro',
        data_criacao: hoje
      });
    }

    const shareMercadoRef = p.vol_total_mensal > 0 ? (volPrataRef / p.vol_total_mensal) : 0;
    if (p.status === 'Ativo' && p.vol_total_mensal > 150000 && shareMercadoRef < 0.25) {
      activeAlerts.push({
        id: 'alert_opp_conc_' + p.id,
        parceiro: p.nome,
        parceiroId: p.id,
        mensagem: `Concentração no Prata abaixo de 25% no mês de ${labelMesRef} (${(shareMercadoRef * 100).toFixed(0)}%) — grande volume de mercado captável.`,
        prioridade: 'Média',
        ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem registro',
        data_criacao: hoje
      });
    }
  }

  return activeAlerts;
}

export default function Dashboard({ onSelectPartner }: { onSelectPartner?: (id: string) => void }) {
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const [logs, setLogs] = useState<CrmLog[]>([]);
  const [allProducoes, setAllProducoes] = useState<ProducaoMensal[]>([]);
  const [semaforo, setSemaforo] = useState<SemafaroStatus | null>(null);
  const [showSemafaroModal, setShowSemafaroModal] = useState<'hunter' | 'farmer' | null>(null);
  const [loading, setLoading] = useState(true);
  const [showImporter, setShowImporter] = useState(false);
  const [selectedKpi, setSelectedKpi] = useState<string | null>(null);
  const [lastWeeklyUploadDate, setLastWeeklyUploadDate] = useState<string>('');
  const [selectedPeriod, setSelectedPeriod] = useState<string>(getDefaultPeriod());
  const [criterios, setCriterios] = useState<CriteriosConfig | null>(null);

  // Alertas gerados dinamicamente
  const [alertas, setAlertas] = useState<{
    id: string;
    parceiro: string;
    parceiroId: string;
    mensagem: string;
    prioridade: 'Alta' | 'Média';
    ultimaInteracao?: string;
    data_criacao: Date;
  }[]>([]);
  const [alertasDismissed, setAlertasDismissed] = useState<Set<string>>(new Set());
  const [alertaDismissConfirm, setAlertaDismissConfirm] = useState<string | null>(null);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        setLoading(true);
        const [pList, lList, allProds, allSemanais, config] = await Promise.all([
          dataService.getParceiros(),
          dataService.getLogs(),
          dataService.getAllProducao(),
          dataService.getAllProducoesSemanais(),
          dataService.getCriterios()
        ]);

        // Garantir que o mês atual aparece no Dashboard mesmo antes do fechamento
        // mensal. O consolidateMensal gera um registro em `producao` quando semanas
        // são salvas — mas em caso de qualquer falha silenciosa ou race condition,
        // reconstruímos aqui o consolidado a partir das semanas brutas.
        const refAtual = getCurrentPeriodRef();
        const prodsComMesAtual = [...allProds];
        // Agrupar semanas do mês atual por parceiro
        const semanasMesAtual = allSemanais.filter(
          s => s.ano === refAtual.ano && s.mes === refAtual.mes
        );
        const semanaisPorParceiro: Record<string, typeof semanasMesAtual> = {};
        semanasMesAtual.forEach(s => {
          if (!semanaisPorParceiro[s.parceiro_id]) semanaisPorParceiro[s.parceiro_id] = [];
          semanaisPorParceiro[s.parceiro_id].push(s);
        });
        // Para cada parceiro com semanas no mês atual, verificar se já existe
        // registro mensal consolidado; se não, sintetizar um temporário in-memory.
        Object.entries(semanaisPorParceiro).forEach(([parceiroId, semanas]) => {
          const jaExiste = prodsComMesAtual.some(
            p => p.parceiro_id === parceiroId && p.ano === refAtual.ano && p.mes === refAtual.mes
          );
          if (!jaExiste) {
            const sumFgts = semanas.reduce((a, s) => a + (s.vol_fgts || 0), 0);
            const sumClt = semanas.reduce((a, s) => a + (s.vol_clt || 0), 0);
            const sumCgv = semanas.reduce((a, s) => a + (s.vol_cgv || 0), 0);
            const sumPix = semanas.reduce((a, s) => a + (s.vol_pix || 0), 0);
            const sumPropostas = semanas.reduce((a, s) => a + (s.propostas_pagas || 0), 0);
            prodsComMesAtual.push({
              id: `__sintetico_${parceiroId}_${refAtual.ano}_${refAtual.mes}`,
              parceiro_id: parceiroId,
              ano: refAtual.ano,
              mes: refAtual.mes,
              vol_fgts: sumFgts,
              vol_clt: sumClt,
              vol_cgv: sumCgv,
              vol_pix: sumPix,
              propostas_pagas: sumPropostas,
              vol_total: sumFgts + sumClt + sumCgv + sumPix
            } as ProducaoMensal);
          }
        });

        const sem = await dataService.getSemafaroStatus(pList);
        const uploadDate = dataService.getLastWeeklyUploadDate();
        
        setParceiros(pList);
        setLogs(lList);
        setAllProducoes(prodsComMesAtual);
        setSemaforo(sem);
        setLastWeeklyUploadDate(uploadDate);
        setCriterios(config);

        const activeAlerts = gerarAlertasDinamicos(pList, lList, prodsComMesAtual);
        setAlertas(activeAlerts);
      } catch (e) {
        console.error('Erro ao carregar dados do dashboard:', e);
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, []);

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', fontSize: '1.1rem', fontWeight: 500 }}>Carregando estatísticas do CRM...</div>;
  }

  // --- CÁLCULO DOS KPIs GLOBAIS E DE PERÍODOS ---
  const activeMonths = getMonthsForPeriod(selectedPeriod);
  const numMonths = activeMonths.length;

  // Recalcular parceiros e seus status para o período selecionado
  const parceirosNoPeriodo = dataService.getParceirosComStatusNoPeriodo(
    parceiros,
    allProducoes,
    selectedPeriod,
    criterios?.limites
  );

  // Mapa de relacionamento parceiro_id -> faturamentos acumulados no período selecionado
  const parceiroProdMap: Record<string, { fgts: number; clt: number; cgv: number; pix: number; total: number }> = {};

  allProducoes.forEach(prod => {
    const match = activeMonths.some(m => m.ano === prod.ano && m.mes === prod.mes);
    if (match) {
      const vol = (prod.vol_fgts || 0) + (prod.vol_clt || 0) + (prod.vol_cgv || 0) + (prod.vol_pix || 0);

      if (!parceiroProdMap[prod.parceiro_id]) {
        parceiroProdMap[prod.parceiro_id] = { fgts: 0, clt: 0, cgv: 0, pix: 0, total: 0 };
      }
      parceiroProdMap[prod.parceiro_id].fgts += prod.vol_fgts || 0;
      parceiroProdMap[prod.parceiro_id].clt += prod.vol_clt || 0;
      parceiroProdMap[prod.parceiro_id].cgv += prod.vol_cgv || 0;
      parceiroProdMap[prod.parceiro_id].pix += prod.vol_pix || 0;
      parceiroProdMap[prod.parceiro_id].total += vol;
    }
  });

  // Cálculo de KPIs Médios (se o período tiver múltiplos meses, calculamos a média de cada mês)
  let parceirosAtivos = 0;
  let taxaAtivos = 0;
  let inativos = 0;
  let churnRate = 0;
  let mixProdutos = { fgts: 0, clt: 0, cgv: 0, pix: 0 };

  if (numMonths > 1) {
    let somaAtivos = 0;
    let somaTaxaAtivos = 0;
    let somaInativos = 0;
    let somaChurnRate = 0;
    let somaFgts = 0;
    let somaClt = 0;
    let somaCgv = 0;
    let somaPix = 0;

    activeMonths.forEach(m => {
      const mesPeriodStr = `${m.ano}-${m.mes}`;
      const pNoMes = dataService.getParceirosComStatusNoPeriodo(parceiros, allProducoes, mesPeriodStr, criterios?.limites);
      
      const ativosNoMes = pNoMes.filter(p => p.status === 'Ativo');
      const qtdAtivosNoMes = ativosNoMes.length;

      let fgtsAtivosNoMes = 0;
      let cltAtivosNoMes = 0;
      let cgvAtivosNoMes = 0;
      let pixAtivosNoMes = 0;

      ativosNoMes.forEach(p => {
        const prod = allProducoes.find(pr => pr.parceiro_id === p.id && pr.ano === m.ano && pr.mes === m.mes);
        const volFgts = prod?.vol_fgts || 0;
        const volClt = prod?.vol_clt || 0;
        const volCgv = prod?.vol_cgv || 0;
        const volPix = prod?.vol_pix || 0;

        fgtsAtivosNoMes += volFgts;
        cltAtivosNoMes += volClt;
        cgvAtivosNoMes += volCgv;
        pixAtivosNoMes += volPix;
      });

      somaAtivos += qtdAtivosNoMes;
      somaTaxaAtivos += pNoMes.length > 0 ? (qtdAtivosNoMes / pNoMes.length) * 100 : 0;
      somaInativos += pNoMes.filter(p => p.status === 'Inativo').length;
      somaChurnRate += pNoMes.length > 0 ? (pNoMes.filter(p => p.status === 'Inativo').length / pNoMes.length) * 100 : 0;
      
      somaFgts += fgtsAtivosNoMes;
      somaClt += cltAtivosNoMes;
      somaCgv += cgvAtivosNoMes;
      somaPix += pixAtivosNoMes;
    });

    parceirosAtivos = somaAtivos / numMonths;
    taxaAtivos = somaTaxaAtivos / numMonths;
    inativos = somaInativos / numMonths;
    churnRate = somaChurnRate / numMonths;
    
    mixProdutos = {
      fgts: somaFgts / numMonths,
      clt: somaClt / numMonths,
      cgv: somaCgv / numMonths,
      pix: somaPix / numMonths
    };
  } else {
    const ativosNoPeriodo = parceirosNoPeriodo.filter(p => p.status === 'Ativo');
    const qtdAtivos = ativosNoPeriodo.length;

    parceirosAtivos = qtdAtivos;
    taxaAtivos = parceirosNoPeriodo.length > 0 ? (parceirosAtivos / parceirosNoPeriodo.length) * 100 : 0;
    inativos = parceirosNoPeriodo.filter(p => p.status === 'Inativo').length;
    churnRate = parceirosNoPeriodo.length > 0 ? (inativos / parceirosNoPeriodo.length) * 100 : 0;
    
    let fgtsAtivos = 0;
    let cltAtivos = 0;
    let cgvAtivos = 0;
    let pixAtivos = 0;

    ativosNoPeriodo.forEach(p => {
      const m = activeMonths[0];
      const prod = allProducoes.find(pr => pr.parceiro_id === p.id && pr.ano === m.ano && pr.mes === m.mes);
      const volFgts = prod?.vol_fgts || 0;
      const volClt = prod?.vol_clt || 0;
      const volCgv = prod?.vol_cgv || 0;
      const volPix = prod?.vol_pix || 0;

      fgtsAtivos += volFgts;
      cltAtivos += volClt;
      cgvAtivos += volCgv;
      pixAtivos += volPix;
    });

    mixProdutos = {
      fgts: fgtsAtivos,
      clt: cltAtivos,
      cgv: cgvAtivos,
      pix: pixAtivos
    };
  }

  // Taxa de Reativação Dinâmica
  const taxaReativacaoDinamica = dataService.getTaxaReativacaoNoPeriodo(
    parceiros,
    allProducoes,
    selectedPeriod,
    criterios?.limites
  );


  // Média de Produtos por Parceiro: considera apenas parceiros com status "Ativo"
  // no período selecionado (parceiros em Inativo/Reativado/Onboarding são excluídos do
  // numerador e do denominador, para não distorcer o indicador de cross-sell).
  let totalProdutosOperados = 0;
  const parceirosAtivosNoPeriodo = parceirosNoPeriodo.filter(p => p.status === 'Ativo');
  parceirosAtivosNoPeriodo.forEach(p => {
    const prodData = parceiroProdMap[p.id];
    if (prodData) {
      let count = 0;
      if (prodData.fgts > 0) count++;
      if (prodData.clt > 0) count++;
      if (prodData.cgv > 0) count++;
      if (prodData.pix > 0) count++;
      totalProdutosOperados += count;
    }
  });
  const mediaProdutos = parceirosAtivosNoPeriodo.length > 0 ? totalProdutosOperados / parceirosAtivosNoPeriodo.length : 0;

  // Formatar Moeda
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  };

  return (
    <div className="fade-in">
      {/* Título */}
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--secondary-color)' }}>
            Estatísticas Comerciais
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
            Indicadores de faturamento e inteligência comercial · Monique
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {/* Seletor de Período */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>PERÍODO:</span>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="form-input"
              style={{ fontSize: '0.85rem', padding: '0.4rem 2rem 0.4rem 0.75rem', width: 'auto', margin: 0, height: '36px', borderRadius: 'var(--radius-sm)' }}
            >
              {getPeriodOptions().map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <button 
            onClick={() => setShowImporter(true)} 
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', padding: '0.5rem 1rem', height: '36px' }}
          >
            <Upload size={16} /> Importar Planilha Semanal
          </button>
          <div style={{ 
            padding: '0.5rem 1rem', 
            fontSize: '0.8rem', 
            fontWeight: 700, 
            color: '#dc2626',
            backgroundColor: 'rgba(220, 38, 38, 0.08)',
            border: '1px solid rgba(220, 38, 38, 0.2)',
            borderRadius: 'var(--radius-sm)',
            height: '36px',
            display: 'flex',
            alignItems: 'center'
          }}>
            Atualizado: {lastWeeklyUploadDate ? new Date(lastWeeklyUploadDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Sem carga'}
          </div>
        </div>
      </div>


      {/* Grid de KPIs Inferiores (Status da Carteira) */}
      <div className="dashboard-summary-grid" style={{ marginBottom: '2rem' }}>
        {/* KPI 4: Parceiros Ativos */}
        <div className="card kpi-card" onClick={() => setSelectedKpi('parceiros-ativos')}>
          <div>
            <span className="kpi-label">Parceiros Ativos</span>
            <div className="kpi-value">{parceirosAtivos}</div>
            <span className="kpi-meta" style={{ color: 'var(--text-muted)' }}>
              Total geral: {parceiros.length} (Semáforo/Alertas fixos)
            </span>
          </div>
          <div className="kpi-icon-container">
            <Users size={24} />
          </div>
        </div>

        {/* KPI 5: Taxa de Ativos */}
        <div className="card kpi-card" onClick={() => setSelectedKpi('taxa-ativos')}>
          <div>
            <span className="kpi-label">Taxa de Parceiros Ativos</span>
            <div className="kpi-value">{taxaAtivos.toFixed(1)}%</div>
            <span className={`kpi-meta ${taxaAtivos >= (criterios?.metas.meta_taxa_ativos ?? 70) ? 'success' : 'danger'}`}>Meta: &ge; {criterios?.metas.meta_taxa_ativos ?? 70}%</span>
          </div>
          <div className="kpi-icon-container">
            <Percent size={24} />
          </div>
        </div>

        {/* KPI 6: Churn da Carteira */}
        <div className="card kpi-card" 
             style={{ borderLeft: churnRate >= (criterios?.metas.meta_churn ?? 10) ? '4px solid var(--danger)' : '1px solid var(--border-color)' }}
             onClick={() => setSelectedKpi('churn')}>
          <div>
            <span className="kpi-label">Churn da Carteira</span>
            <div className="kpi-value" style={{ color: churnRate >= (criterios?.metas.meta_churn ?? 10) ? 'var(--danger)' : 'inherit' }}>{churnRate.toFixed(1)}%</div>
            <span className={`kpi-meta ${churnRate < (criterios?.metas.meta_churn ?? 10) ? 'success' : 'danger'}`}>Meta: &lt; {criterios?.metas.meta_churn ?? 10}%</span>
          </div>
          <div className="kpi-icon-container" style={{ color: 'var(--danger)', backgroundColor: 'rgba(239, 68, 68, 0.15)' }}>
            <AlertCircle size={24} />
          </div>
        </div>
      </div>

      {/* Grid de KPIs Auxiliares (Demais Métricas) */}
      <div className="dashboard-summary-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: '2rem' }}>
        <div className="card kpi-card" style={{ padding: '1rem 1.25rem' }} onClick={() => setSelectedKpi('media-produtos')}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>MÉDIA DE PRODUTOS</span>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--secondary-color)', margin: '0.2rem 0' }}>
            {mediaProdutos.toFixed(1)}
          </div>
          <span style={{ fontSize: '0.7rem', color: mediaProdutos >= (criterios?.metas.meta_media_produtos ?? 2) ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
            Meta: &ge; {criterios?.metas.meta_media_produtos ?? 2}
          </span>
        </div>

        <div className="card kpi-card" style={{ padding: '1rem 1.25rem' }} onClick={() => setSelectedKpi('taxa-reativacao')}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>TAXA DE REATIVAÇÃO</span>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--secondary-color)', margin: '0.2rem 0' }}>
            {taxaReativacaoDinamica.toFixed(1)}%
          </div>
          <span style={{ fontSize: '0.7rem', color: taxaReativacaoDinamica >= (criterios?.metas.meta_taxa_reativacao ?? 25) ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>Meta: &ge; {criterios?.metas.meta_taxa_reativacao ?? 25}%</span>
        </div>
      </div>

      {/* Gráfico de Mix de Faturamento por Produto */}
      {(() => {
        const total = mixProdutos.fgts + mixProdutos.clt + mixProdutos.cgv + mixProdutos.pix || 1;
        const pFgts = (mixProdutos.fgts / total) * 100;
        const pClt = (mixProdutos.clt / total) * 100;
        const pCgv = (mixProdutos.cgv / total) * 100;
        const pPix = (mixProdutos.pix / total) * 100;

        return (
          <div className="card" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
            <h3 className="card-title" style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <PieChart size={20} style={{ color: 'var(--primary-color)' }} /> Mix de Faturamento por Produto ({getPeriodLabel(selectedPeriod)})
            </h3>
            
            {/* Barra consolidada de Mix */}
            <div style={{
              width: '100%',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              display: 'flex',
              border: '1px solid var(--border-color)',
              marginBottom: '1.5rem'
            }}>
              {mixProdutos.fgts > 0 && (
                <div style={{ width: `${pFgts}%`, backgroundColor: '#3b82f6', height: '100%' }} title={`FGTS: ${pFgts.toFixed(1)}%`}></div>
              )}
              {mixProdutos.clt > 0 && (
                <div style={{ width: `${pClt}%`, backgroundColor: '#10b981', height: '100%' }} title={`CLT: ${pClt.toFixed(1)}%`}></div>
              )}
              {mixProdutos.cgv > 0 && (
                <div style={{ width: `${pCgv}%`, backgroundColor: '#f59e0b', height: '100%' }} title={`CGV: ${pCgv.toFixed(1)}%`}></div>
              )}
              {mixProdutos.pix > 0 && (
                <div style={{ width: `${pPix}%`, backgroundColor: '#8b5cf6', height: '100%' }} title={`Pix: ${pPix.toFixed(1)}%`}></div>
              )}
            </div>

            {/* Detalhes do Mix por Produto */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                <span style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#3b82f6' }}></span>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>FGTS SAQUE-ANIVERSÁRIO</span>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--secondary-color)' }}>
                    {formatCurrency(mixProdutos.fgts)} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 550 }}>({pFgts.toFixed(1)}%)</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                <span style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#10b981' }}></span>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>CLT CONSIGNADO</span>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--secondary-color)' }}>
                    {formatCurrency(mixProdutos.clt)} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 550 }}>({pClt.toFixed(1)}%)</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                <span style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#f59e0b' }}></span>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>CGV (GARANTIA DE VEÍCULO)</span>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--secondary-color)' }}>
                    {formatCurrency(mixProdutos.cgv)} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 550 }}>({pCgv.toFixed(1)}%)</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                <span style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#8b5cf6' }}></span>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>PIX NO CARTÃO DE CRÉDITO</span>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--secondary-color)' }}>
                    {formatCurrency(mixProdutos.pix)} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 550 }}>({pPix.toFixed(1)}%)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Semáforo de Desempenho Semanal */}
      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--secondary-color)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          Semáforo de Desempenho Semanal
        </h3>
        
        {semaforo && (
          <div className="semaforo-container">
            {/* Hunter / Winback */}
            <div className={`card semaforo-card ${semaforo.hunter}`} onClick={() => setShowSemafaroModal('hunter')} style={{ cursor: 'pointer' }}>
              <div className="semaforo-header">
                <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>WINBACK / HUNTER</span>
                <div className="semaforo-indicator">
                  <span className={`semaforo-dot ${semaforo.hunter}`}></span>
                  <span style={{ color: semaforo.hunter === 'Verde' ? 'var(--success)' : 'var(--danger)' }}>{semaforo.hunter}</span>
                </div>
              </div>

              {/* Período */}
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{semaforo.semanaInfo.label} &nbsp;·&nbsp; {semaforo.semanaInfo.labelRange}</span>
                <span style={{ fontSize: '0.68rem', color: 'var(--accent-color)', opacity: 0.7 }}>▶ ver mês completo</span>
              </div>

              {/* Contagens */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div style={{
                  padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-sm)',
                  backgroundColor: semaforo.hunterAtivacoes.length > 0 ? 'rgba(16,185,129,0.18)' : 'rgba(0,0,0,0.2)',
                  border: `1px solid ${semaforo.hunterAtivacoes.length > 0 ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'}`
                }}>
                  <div style={{ fontSize: '0.7rem', color: '#8ecfb8', textTransform: 'uppercase', fontWeight: 600 }}>Ativações</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: semaforo.hunterAtivacoes.length > 0 ? '#d1fae5' : 'var(--text-muted)', lineHeight: 1.2 }}>
                    {semaforo.hunterAtivacoes.length}
                  </div>
                </div>
                <div style={{
                  padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-sm)',
                  backgroundColor: semaforo.hunterReativacoes.length > 0 ? 'rgba(16,185,129,0.18)' : 'rgba(0,0,0,0.2)',
                  border: `1px solid ${semaforo.hunterReativacoes.length > 0 ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'}`
                }}>
                  <div style={{ fontSize: '0.7rem', color: '#8ecfb8', textTransform: 'uppercase', fontWeight: 600 }}>Reativações</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: semaforo.hunterReativacoes.length > 0 ? '#d1fae5' : 'var(--text-muted)', lineHeight: 1.2 }}>
                    {semaforo.hunterReativacoes.length}
                  </div>
                </div>
              </div>

              <div style={{ padding: '0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                <strong>Recomendação:</strong> {semaforo.hunterAcao}
              </div>
            </div>

            {/* Farmer */}
            <div className={`card semaforo-card ${semaforo.farmer}`} onClick={() => setShowSemafaroModal('farmer')} style={{ cursor: 'pointer' }}>
              <div className="semaforo-header">
                <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>CARTEIRA / FARMER</span>
                <div className="semaforo-indicator">
                  <span className={`semaforo-dot ${semaforo.farmer}`}></span>
                  <span style={{ color: semaforo.farmer === 'Verde' ? 'var(--success)' : 'var(--danger)' }}>{semaforo.farmer}</span>
                </div>
              </div>

              {/* Período */}
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{semaforo.semanaInfo.label} &nbsp;·&nbsp; {semaforo.semanaInfo.labelRange}</span>
                <span style={{ fontSize: '0.68rem', color: 'var(--accent-color)', opacity: 0.7 }}>▶ ver mês completo</span>
              </div>

              {/* Propostas realizadas vs meta */}
              <div style={{
                padding: '0.75rem', borderRadius: 'var(--radius-sm)', marginBottom: '0.75rem',
                backgroundColor: semaforo.farmer === 'Verde' ? 'rgba(16,185,129,0.18)' : 'rgba(0,0,0,0.2)',
                border: `1px solid ${semaforo.farmer === 'Verde' ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'}`
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#8ecfb8', textTransform: 'uppercase', fontWeight: 600 }}>Propostas Pagas</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: semaforo.farmer === 'Verde' ? '#d1fae5' : 'var(--danger)', lineHeight: 1.1 }}>
                      {semaforo.farmerPropostasSemana.toLocaleString('pt-BR')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Meta</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                      {criterios?.metas.farmer_propostas_pagas_semana?.toLocaleString('pt-BR') || '1.200'}
                    </div>
                  </div>
                </div>
                {/* Barra de progresso */}
                {(() => {
                  const meta = criterios?.metas.farmer_propostas_pagas_semana || 1200;
                  const pct = Math.min(100, Math.round((semaforo.farmerPropostasSemana / meta) * 100));
                  return (
                    <div style={{ marginTop: '0.5rem', width: '100%', height: '5px', borderRadius: '3px', backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: semaforo.farmer === 'Verde' ? 'var(--success)' : 'var(--danger)', transition: 'width 0.4s ease' }} />
                    </div>
                  );
                })()}
              </div>

              <div style={{ padding: '0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                <strong>Recomendação:</strong> {semaforo.farmerAcao}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Seção de Gráficos de Desempenho */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Gráfico 1: Top 5 Parceiros (Prata vs Mercado) */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 className="card-title" style={{ marginBottom: '1.25rem' }}>
            <TrendingUp size={20} /> Comparativo de Volumes: Mercado vs Prata (Top 5 - {getPeriodLabel(selectedPeriod)})
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1rem' }}>
            {parceiros
              .sort((a, b) => b.vol_total_mensal - a.vol_total_mensal)
              .slice(0, 5)
              .map(p => {
                const volPrataPeriodo = (parceiroProdMap[p.id]?.total || 0) / numMonths;
                const percPrata = p.vol_total_mensal > 0 ? (volPrataPeriodo / p.vol_total_mensal) * 100 : 0;
                return (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600 }}>
                      <span style={{ color: 'var(--secondary-color)' }}>{p.nome}</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        Prata: <strong style={{ color: 'var(--primary-color)' }}>{percPrata.toFixed(0)}%</strong> ({formatCurrency(volPrataPeriodo)})
                      </span>
                    </div>
                    {/* Barra de Progresso Mercado vs Prata */}
                    <div style={{
                      width: '100%',
                      height: '24px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: '#f1f5f9',
                      overflow: 'hidden',
                      position: 'relative',
                      border: '1px solid var(--border-color)'
                    }}>
                      {/* Barra Mercado */}
                      <div style={{
                        width: '100%',
                        height: '100%',
                        backgroundColor: '#cbd5e1',
                        position: 'absolute',
                        top: 0,
                        left: 0
                      }}></div>
                      {/* Barra Prata */}
                      <div style={{
                        width: `${percPrata}%`,
                        height: '100%',
                        backgroundColor: 'var(--primary-color)',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        transition: 'width 0.8s ease-in-out'
                      }}></div>
                      {/* Texto de Volume Total no final */}
                      <span style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: 'var(--text-main)',
                        zIndex: 2
                      }}>
                        Mercado: {formatCurrency(p.vol_total_mensal)}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Gráfico 2: Distribuição por Classificação (Donut Chart SVG) */}
        <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
          <h3 className="card-title" style={{ marginBottom: '1.25rem' }}>
            <Layers size={20} /> Distribuição da Carteira por Classificação
          </h3>
          
          {(() => {
            const strat = parceirosNoPeriodo.filter(p => p.classificacao === 'Estratégico').length;
            const cresc = parceirosNoPeriodo.filter(p => p.classificacao === 'Crescimento').length;
            const desenv = parceirosNoPeriodo.filter(p => p.classificacao === 'Desenvolvimento').length;
            const total = parceirosNoPeriodo.length || 1;

            const pStrat = (strat / total) * 100;
            const pCresc = (cresc / total) * 100;
            const pDesenv = (desenv / total) * 100;

            const radius = 50;
            const circumference = 2 * Math.PI * radius; // ~314.159
            
            const strokeStrat = (pStrat / 100) * circumference;
            const strokeCresc = (pCresc / 100) * circumference;
            const strokeDesenv = (pDesenv / 100) * circumference;

            return (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', flex: 1, gap: '1rem', marginTop: '0.5rem' }}>
                <svg width="150" height="150" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="60" cy="60" r={radius} fill="transparent" stroke="#f1f5f9" strokeWidth="16" />
                  
                  {/* Segmento Estratégico (Verde Esmeralda) */}
                  {pStrat > 0 && (
                    <circle cx="60" cy="60" r={radius} fill="transparent" 
                      stroke="#10b981" strokeWidth="16" 
                      strokeDasharray={`${strokeStrat} ${circumference}`}
                      strokeDashoffset="0"
                    />
                  )}
                  {/* Segmento Crescimento (Azul Info) */}
                  {pCresc > 0 && (
                    <circle cx="60" cy="60" r={radius} fill="transparent" 
                      stroke="#3b82f6" strokeWidth="16" 
                      strokeDasharray={`${strokeCresc} ${circumference}`}
                      strokeDashoffset={-strokeStrat}
                    />
                  )}
                  {/* Segmento Desenvolvimento (Roxo) */}
                  {pDesenv > 0 && (
                    <circle cx="60" cy="60" r={radius} fill="transparent" 
                      stroke="#8b5cf6" strokeWidth="16" 
                      strokeDasharray={`${strokeDesenv} ${circumference}`}
                      strokeDashoffset={-(strokeStrat + strokeCresc)}
                    />
                  )}
                  
                  {/* Círculo Central para efeito Donut */}
                  <circle cx="60" cy="60" r="38" fill="var(--card-bg)" />
                  
                  <g style={{ transform: 'rotate(90deg) translate(50px, -65px)', transformOrigin: 'center' }}>
                    <text x="10" y="-10" textAnchor="middle" style={{ fontSize: '10px', fontWeight: 800, fill: 'var(--secondary-color)' }}>{parceirosNoPeriodo.length}</text>
                    <text x="10" y="2" textAnchor="middle" style={{ fontSize: '5px', fontWeight: 600, fill: 'var(--text-muted)' }}>PARCEIROS</text>
                  </g>
                </svg>

                {/* Legendas */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#10b981' }}></span>
                    <span style={{ fontWeight: 550, color: 'var(--text-main)' }}>Estratégico: <strong>{strat}</strong> ({pStrat.toFixed(0)}%)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#3b82f6' }}></span>
                    <span style={{ fontWeight: 550, color: 'var(--text-main)' }}>Crescimento: <strong>{cresc}</strong> ({pCresc.toFixed(0)}%)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#8b5cf6' }}></span>
                    <span style={{ fontWeight: 550, color: 'var(--text-main)' }}>Desenvolvimento: <strong>{desenv}</strong> ({pDesenv.toFixed(0)}%)</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

      </div>

      {/* Grid Duplo: Alertas e Ranking */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* Alertas Ativos */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 className="card-title" style={{ color: 'var(--danger)', marginBottom: '1.25rem' }}>
            <AlertCircle size={20} /> Alertas de Gestão Comercial
          </h3>
          
          <div style={{ maxHeight: '420px', overflowY: 'auto', paddingRight: '0.25rem' }}>
            {alertas.filter(a => !alertasDismissed.has(a.id)).length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '2rem 0' }}>
                Nenhum alerta ativo! Toda a carteira está em dia com as cadências.
              </p>
            ) : (
              alertas
                .filter(a => !alertasDismissed.has(a.id))
                .map(alert => {
                  // Um alerta pode ser descartado manualmente apenas se não houver
                  // registro de contato com data posterior à criação do alerta.
                  const logsDosParceiro = logs.filter(l => l.parceiro_id === alert.parceiroId);
                  const temContatoAposAlerta = logsDosParceiro.some(
                    l => new Date(l.data_contato) > alert.data_criacao
                  );
                  const podeDismiss = !temContatoAposAlerta;
                  const confirmandoEste = alertaDismissConfirm === alert.id;

                  return (
                    <div 
                      key={alert.id} 
                      className={`alert-item ${alert.prioridade}`}
                      style={{ cursor: onSelectPartner ? 'pointer' : 'default', position: 'relative' }}
                      onClick={() => onSelectPartner?.(alert.parceiroId)}
                    >
                      <div className="alert-body">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span
                            style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--secondary-color)' }}
                          >
                            {alert.parceiro}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span className={`badge ${alert.prioridade === 'Alta' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: '0.65rem' }}>
                              {alert.prioridade}
                            </span>
                            {podeDismiss && (
                              <button
                                title="Descartar alerta"
                                onClick={e => { e.stopPropagation(); setAlertaDismissConfirm(confirmandoEste ? null : alert.id); }}
                                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.1rem', display: 'flex', alignItems: 'center', opacity: 0.7 }}
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="alert-text" style={{ marginTop: '0.35rem', fontWeight: 550 }}>{alert.mensagem}</p>
                        <div className="alert-meta">
                          <span>Último Contato: {alert.ultimaInteracao}</span>
                        </div>
                        {confirmandoEste && (
                          <div style={{ marginTop: '0.6rem', padding: '0.5rem 0.65rem', backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.78rem' }}>
                            <p style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: '0.4rem' }}>
                              Confirmar descarte do alerta?
                            </p>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.73rem', marginBottom: '0.5rem' }}>
                              O alerta será removido da lista. Ele voltará a aparecer caso as condições persistam no próximo carregamento.
                            </p>
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button
                                onClick={e => { e.stopPropagation(); setAlertasDismissed(prev => new Set([...prev, alert.id])); setAlertaDismissConfirm(null); }}
                                style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', backgroundColor: 'var(--danger)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                              >
                                Descartar
                              </button>
                              <button
                                onClick={e => { e.stopPropagation(); setAlertaDismissConfirm(null); }}
                                style={{ fontSize: '0.72rem', padding: '0.2rem 0.6rem', backgroundColor: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>

        {/* Ranking de Parceiros */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 className="card-title" style={{ marginBottom: '1.25rem' }}>
            <Briefcase size={20} /> Ranking de Parceiros (Produção - {getPeriodLabel(selectedPeriod)})
          </h3>
          
          <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)' }}>Pos.</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)' }}>Parceiro</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right' }}>Vol. Prata</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right' }}>Conc. %</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'center' }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {[...parceirosNoPeriodo]
                  .map(p => ({
                    ...p,
                    volPrataPeriodo: (parceiroProdMap[p.id]?.total || 0) / numMonths
                  }))
                  .sort((a, b) => b.volPrataPeriodo - a.volPrataPeriodo)
                  .slice(0, 5)
                  .map((p, index) => {
                    const concText = p.vol_total_mensal > 0 ? `${((p.volPrataPeriodo / p.vol_total_mensal) * 100).toFixed(0)}%` : 'NVT';
                    return (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 700, color: index === 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                          #{index + 1}
                        </td>
                        <td style={{ fontWeight: 600 }}>{p.nome}</td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>
                          {formatCurrency(p.volPrataPeriodo)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>
                          {concText}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`badge ${p.score_comercial >= 80 ? 'badge-success' : p.score_comercial >= 50 ? 'badge-info' : 'badge-warning'}`}>
                            {p.score_comercial}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showImporter && (
        <ExcelImporter 
          onClose={() => setShowImporter(false)}
          onImportSuccess={async () => {
            try {
              const newUploadDate = new Date().toISOString();
              dataService.setLastWeeklyUploadDate(newUploadDate);
              setLastWeeklyUploadDate(newUploadDate);

              // Recarregar os dados do Dashboard após importação em lote
              const [pList, lList, allProds, allSemanais] = await Promise.all([
                dataService.getParceiros(),
                dataService.getLogs(),
                dataService.getAllProducao(),
                dataService.getAllProducoesSemanais()
              ]);

              // Consolidar mês atual a partir de semanas (mesmo algoritmo do load inicial)
              const refAtual = getCurrentPeriodRef();
              const prodsComMesAtual = [...allProds];
              const semanasMesAtual = allSemanais.filter(
                s => s.ano === refAtual.ano && s.mes === refAtual.mes
              );
              const semanaisPorParceiro: Record<string, typeof semanasMesAtual> = {};
              semanasMesAtual.forEach(s => {
                if (!semanaisPorParceiro[s.parceiro_id]) semanaisPorParceiro[s.parceiro_id] = [];
                semanaisPorParceiro[s.parceiro_id].push(s);
              });
              Object.entries(semanaisPorParceiro).forEach(([parceiroId, semanas]) => {
                const jaExiste = prodsComMesAtual.some(
                  p => p.parceiro_id === parceiroId && p.ano === refAtual.ano && p.mes === refAtual.mes
                );
                if (!jaExiste) {
                  const sumFgts = semanas.reduce((a, s) => a + (s.vol_fgts || 0), 0);
                  const sumClt = semanas.reduce((a, s) => a + (s.vol_clt || 0), 0);
                  const sumCgv = semanas.reduce((a, s) => a + (s.vol_cgv || 0), 0);
                  const sumPix = semanas.reduce((a, s) => a + (s.vol_pix || 0), 0);
                  const sumPropostas = semanas.reduce((a, s) => a + (s.propostas_pagas || 0), 0);
                  prodsComMesAtual.push({
                    id: `__sintetico_${parceiroId}_${refAtual.ano}_${refAtual.mes}`,
                    parceiro_id: parceiroId,
                    ano: refAtual.ano,
                    mes: refAtual.mes,
                    vol_fgts: sumFgts,
                    vol_clt: sumClt,
                    vol_cgv: sumCgv,
                    vol_pix: sumPix,
                    propostas_pagas: sumPropostas,
                    vol_total: sumFgts + sumClt + sumCgv + sumPix
                  } as ProducaoMensal);
                }
              });

              const sem = await dataService.getSemafaroStatus(pList);
              
              setParceiros(pList);
              setLogs(lList);
              setAllProducoes(prodsComMesAtual);
              setSemaforo(sem);

              // Atualizar alertas
              const activeAlerts = gerarAlertasDinamicos(pList, lList, prodsComMesAtual);
              setAlertas(activeAlerts);
            } catch (err) {
              console.error('Erro ao atualizar dados pós-importação:', err);
            }
          }}
        />
      )}

      {selectedKpi && (
        <KpiOriginModal 
          kpiType={selectedKpi}
          onClose={() => setSelectedKpi(null)}
          parceiros={parceirosNoPeriodo}
          allProducoes={allProducoes}
          allLogs={logs}
          selectedPeriod={selectedPeriod}
        />
      )}

      {showSemafaroModal && semaforo && (
        <SemafaroMesModal
          tipo={showSemafaroModal}
          semanaAtual={semaforo.semanaInfo}
          criterios={criterios}
          onClose={() => setShowSemafaroModal(null)}
        />
      )}
    </div>
  );
}

// ─── Modal: Semanas fechadas do mês corrente (Semáforo) ────────────────────────
interface SemafaroMesModalProps {
  tipo: 'hunter' | 'farmer';
  semanaAtual: { ano: number; mes: number };
  criterios: CriteriosConfig | null;
  onClose: () => void;
}

function SemafaroMesModal({ tipo, semanaAtual, criterios, onClose }: SemafaroMesModalProps) {
  const [loading, setLoading] = useState(true);
  // Hunter
  const [eventosPorSemana, setEventosPorSemana] = useState<Record<string, { ativacoes: EventoSemana[]; reativacoes: EventoSemana[] }>>({});
  const [semanasOrdem, setSemanasOrdem] = useState<string[]>([]);
  // Farmer
  const [farmerSemanais, setFarmerSemanais] = useState<{ semana_inicio: string; semana_num: number; total: number }[]>([]);

  const { ano, mes } = semanaAtual;
  const nomeMes = NOMES_MESES[mes - 1];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      if (tipo === 'hunter') {
        const eventos = await dataService.getEventosMes(ano, mes);
        if (cancelled) return;
        // Agrupa por semana_inicio
        const grouped: Record<string, { ativacoes: EventoSemana[]; reativacoes: EventoSemana[] }> = {};
        const ordem: string[] = [];
        eventos.forEach((e) => {
          if (!grouped[e.semana_inicio]) {
            grouped[e.semana_inicio] = { ativacoes: [], reativacoes: [] };
            ordem.push(e.semana_inicio);
          }
          if (e.tipo === 'ativacao') grouped[e.semana_inicio].ativacoes.push(e);
          else grouped[e.semana_inicio].reativacoes.push(e);
        });
        setEventosPorSemana(grouped);
        setSemanasOrdem(ordem);
      } else {
        const semanais = await dataService.getProducoesSemanaisMes(ano, mes);
        if (cancelled) return;
        setFarmerSemanais(semanais);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [tipo, ano, mes]);

  const metaHunterNovos     = criterios?.metas.hunter_novos_ativos_semana ?? 2;
  const metaHunterReativados = criterios?.metas.hunter_reativacoes_semana ?? 2;
  const metaFarmer          = criterios?.metas.farmer_propostas_pagas_semana ?? 1200;

  const titulo = tipo === 'hunter' ? 'Winback / Hunter — Semanas do Mês' : 'Carteira / Farmer — Semanas do Mês';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0d2b1f',
          borderRadius: 'var(--radius)',
          border: '1px solid rgba(15,184,130,0.35)',
          padding: '1.5rem',
          width: '100%',
          maxWidth: '640px',
          maxHeight: '85vh',
          overflowY: 'auto'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#e2f5ee' }}>{titulo}</h2>
            <div style={{ fontSize: '0.8rem', color: '#8ecfb8', marginTop: '0.2rem' }}>{nomeMes}/{ano} · semanas fechadas</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem', lineHeight: 1 }}>
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#8ecfb8' }}>Carregando...</div>
        ) : tipo === 'hunter' ? (
          semanasOrdem.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              Nenhuma ativação ou reativação registrada em {nomeMes}/{ano}. (Confira se a importação da semana já foi feita)
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {semanasOrdem.map((semInicio) => {
                const grupo = eventosPorSemana[semInicio];
                const totalAtv = grupo.ativacoes.length;
                const totalReat = grupo.reativacoes.length;
                const atingiu = totalAtv >= metaHunterNovos || totalReat >= metaHunterReativados;
                // Formata o range da semana
                const [y, m, d] = semInicio.split('-');
                const fimDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + 6));
                const fimStr = `${String(fimDate.getUTCDate()).padStart(2,'0')}/${String(fimDate.getUTCMonth()+1).padStart(2,'0')}`;
                const iniStr = `${d}/${m}`;
                const semLabel = `Sem. ${grupo.ativacoes[0]?.semana_num ?? grupo.reativacoes[0]?.semana_num ?? '?'} · ${iniStr} → ${fimStr}`;
                return (
                  <div key={semInicio} style={{ padding: '1rem', borderRadius: 'var(--radius-sm)', border: `1px solid ${atingiu ? 'var(--success)' : 'var(--border-color)'}`, backgroundColor: 'rgba(255,255,255,0.07)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#b8ddd0', textTransform: 'uppercase' }}>{semLabel}</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: atingiu ? 'var(--success)' : 'var(--danger)' }}>{atingiu ? '● Verde' : '● Vermelho'}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: totalAtv + totalReat > 0 ? '0.75rem' : 0 }}>
                      <div style={{ padding: '0.5rem 0.6rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(255,255,255,0.1)' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Ativações</div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: totalAtv > 0 ? 'var(--success)' : 'var(--text-muted)' }}>{totalAtv}</div>
                        <div style={{ fontSize: '0.65rem', color: '#8ecfb8' }}>meta: {metaHunterNovos}</div>
                      </div>
                      <div style={{ padding: '0.5rem 0.6rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(255,255,255,0.1)' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Reativações</div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: totalReat > 0 ? 'var(--success)' : 'var(--text-muted)' }}>{totalReat}</div>
                        <div style={{ fontSize: '0.65rem', color: '#8ecfb8' }}>meta: {metaHunterReativados}</div>
                      </div>
                    </div>
                    {(totalAtv > 0 || totalReat > 0) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        {grupo.ativacoes.map(e => (
                          <div key={e.id || e.parceiro_id + '-atv'} style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-main)' }}>
                            <span style={{ color: 'var(--success)', fontWeight: 700 }}>✓</span>
                            <span style={{ color: '#e2f5ee' }}>{e.parceiro_nome ?? 'Parceiro'}</span>
                            <span className="badge badge-info" style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem' }}>Ativado</span>
                          </div>
                        ))}
                        {grupo.reativacoes.map(e => (
                          <div key={e.id || e.parceiro_id + '-reat'} style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-main)' }}>
                            <span style={{ color: 'var(--warning)', fontWeight: 700 }}>↑</span>
                            <span style={{ color: '#e2f5ee' }}>{e.parceiro_nome ?? 'Parceiro'}</span>
                            <span className="badge badge-warning" style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem' }}>Reativado</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          // FARMER
          farmerSemanais.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              Nenhuma produção semanal registrada em {nomeMes}/{ano}.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {farmerSemanais.map((s) => {
                const atingiu = s.total >= metaFarmer;
                const pct = Math.min(100, Math.round((s.total / metaFarmer) * 100));
                const [y, m, d] = s.semana_inicio.split('-');
                const fimDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + 6));
                const fimStr = `${String(fimDate.getUTCDate()).padStart(2,'0')}/${String(fimDate.getUTCMonth()+1).padStart(2,'0')}`;
                const iniStr = `${d}/${m}`;
                const semLabel = `Sem. ${s.semana_num} · ${iniStr} → ${fimStr}`;
                return (
                  <div key={s.semana_inicio} style={{ padding: '1rem', borderRadius: 'var(--radius-sm)', border: `1px solid ${atingiu ? 'var(--success)' : 'var(--border-color)'}`, backgroundColor: 'rgba(255,255,255,0.07)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#b8ddd0', textTransform: 'uppercase' }}>{semLabel}</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: atingiu ? 'var(--success)' : 'var(--danger)' }}>{atingiu ? '● Verde' : '● Vermelho'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
                      <div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Propostas Pagas</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: atingiu ? 'var(--success)' : 'var(--danger)' }}>{s.total.toLocaleString('pt-BR')}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.68rem', color: '#8ecfb8' }}>Meta</div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#b8ddd0' }}>{metaFarmer.toLocaleString('pt-BR')}</div>
                      </div>
                    </div>
                    <div style={{ width: '100%', height: '5px', borderRadius: '3px', backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: atingiu ? 'var(--success)' : 'var(--danger)', transition: 'width 0.4s ease' }} />
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#8ecfb8', marginTop: '0.3rem', textAlign: 'right' }}>{pct}% da meta</div>
                  </div>
                );
              })}
            </div>
          )
        )}

        <div style={{ marginTop: '1.5rem', textAlign: 'right' }}>
          <button onClick={onClose} className="btn btn-primary" style={{ padding: '0.5rem 1.5rem' }}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

// Modal de auditoria da origem de dados de cada KPI comercial
function KpiOriginModal({ kpiType, onClose, parceiros, allProducoes, allLogs, selectedPeriod }: { kpiType: string; onClose: () => void; parceiros: Parceiro[]; allProducoes: ProducaoMensal[]; allLogs: CrmLog[]; selectedPeriod: string }) {
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<any[]>([]);

  const activeMonths = getMonthsForPeriod(selectedPeriod);
  const numMonths = activeMonths.length;

  // Mapa de faturamento na Prata para cada parceiro no período selecionado
  const parceiroProdMap: Record<string, { fgts: number; clt: number; cgv: number; pix: number; total: number }> = {};
  allProducoes.forEach(prod => {
    const match = activeMonths.some(m => m.ano === prod.ano && m.mes === prod.mes);
    if (match) {
      const vol = (prod.vol_fgts || 0) + (prod.vol_clt || 0) + (prod.vol_cgv || 0) + (prod.vol_pix || 0);
      if (!parceiroProdMap[prod.parceiro_id]) {
        parceiroProdMap[prod.parceiro_id] = { fgts: 0, clt: 0, cgv: 0, pix: 0, total: 0 };
      }
      parceiroProdMap[prod.parceiro_id].fgts += prod.vol_fgts || 0;
      parceiroProdMap[prod.parceiro_id].clt += prod.vol_clt || 0;
      parceiroProdMap[prod.parceiro_id].cgv += prod.vol_cgv || 0;
      parceiroProdMap[prod.parceiro_id].pix += prod.vol_pix || 0;
      parceiroProdMap[prod.parceiro_id].total += vol;
    }
  });

  const getProdutosOperados = (pId: string) => {
    const data = parceiroProdMap[pId];
    if (!data) return [];
    const prods = [];
    if (data.fgts > 0) prods.push('FGTS');
    if (data.clt > 0) prods.push('CLT');
    if (data.cgv > 0) prods.push('CGV');
    if (data.pix > 0) prods.push('Pix');
    return prods;
  };

  useEffect(() => {
    if (kpiType === 'taxa-reativacao') {
      setLoading(true);
      async function calc() {
        try {
          // Achar o menor e o maior mês/ano do período selecionado
          let minAno = 9999, minMes = 13, maxAno = 0, maxMes = 0;
          activeMonths.forEach(m => {
            if (m.ano < minAno || (m.ano === minAno && m.mes < minMes)) { minAno = m.ano; minMes = m.mes; }
            if (m.ano > maxAno || (m.ano === maxAno && m.mes > maxMes)) { maxAno = m.ano; maxMes = m.mes; }
          });

          const mesBase = shiftMonth(minAno, minMes, -1);
          const limites = { dias_inatividade_winback: 60, dias_conversao_hunter: 7 };

          const prodsMap: Record<string, ProducaoMensal[]> = {};
          allProducoes.forEach(prod => {
            if (!prodsMap[prod.parceiro_id]) prodsMap[prod.parceiro_id] = [];
            prodsMap[prod.parceiro_id].push(prod);
          });

          // Universo: parceiros cujo status simulado no mês anterior ao período é Inativo
          const parceirosEmInativo = parceiros.filter(p => {
            const prods = (prodsMap[p.id] || []).filter(pr => (pr.ano < mesBase.ano) || (pr.ano === mesBase.ano && pr.mes <= mesBase.mes));
            return computeStatusAtMonth(p.created_at, prods, limites, mesBase.ano, mesBase.mes) === 'Inativo';
          });

          const list = parceirosEmInativo.map(p => {
            const prods = (prodsMap[p.id] || []).filter(pr => (pr.ano < maxAno) || (pr.ano === maxAno && pr.mes <= maxMes));
            const timeline = computeStatusTimeline(p.created_at, prods, limites, maxAno, maxMes);
            const transicionou = timeline.some(entry =>
              entry.status === 'Reativado' && activeMonths.some(m => m.ano === entry.ano && m.mes === entry.mes)
            );
            const statusAtual = timeline[timeline.length - 1].status;
            const volPrataPeriodo = (parceiroProdMap[p.id]?.total || 0) / numMonths;
            return {
              nome: p.nome,
              inicioWinback: `Base: ${mesBase.mes < 10 ? '0' + mesBase.mes : mesBase.mes}/${mesBase.ano} (Inativo)`,
              transicionou,
              statusAtual,
              classificacao: p.classificacao,
              score: p.score_comercial,
              volPrata: volPrataPeriodo
            };
          });

          setDetails(list);
        } catch (e) {
          console.error(e);
        } finally {
          setLoading(false);
        }
      }
      calc();
    }
  }, [kpiType, parceiros, allProducoes, allLogs, selectedPeriod]);

  // Formatar Moeda
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  };

  // Renderizar o cabeçalho e dados de acordo com o KPI
  let title = '';
  let content = null;

  if (kpiType === 'total-mercado') {
    title = `Detalhamento do Volume de Mercado (Faturamento Mensal Geral - ${getPeriodLabel(selectedPeriod)})`;
    const rows = parceiros.filter(p => p.status === 'Ativo').sort((a, b) => b.vol_total_mensal - a.vol_total_mensal);
    content = (
      <table className="table">
        <thead>
          <tr>
            <th>Parceiro (Ativo)</th>
            <th>Status</th>
            <th>Classificação</th>
            <th style={{ textAlign: 'right' }}>Faturamento Mercado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id}>
              <td style={{ fontWeight: 600 }}>{p.nome}</td>
              <td>
                <span className={`badge ${p.status === 'Ativo' ? 'badge-success' : p.status === 'Inativo' ? 'badge-danger' : p.status === 'Reativado' ? 'badge-warning' : 'badge-info'}`}>
                  {p.status}
                </span>
              </td>
              <td>{p.classificacao}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(p.vol_total_mensal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 800, backgroundColor: 'rgba(0, 0, 0, 0.05)' }}>
            <td colSpan={3}>Volume Total de Mercado</td>
            <td style={{ textAlign: 'right', color: 'var(--primary-color)' }}>
              {formatCurrency(rows.reduce((sum, r) => sum + (r.vol_total_mensal || 0), 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    );
  } else if (kpiType === 'total-prata') {
    title = `Detalhamento do Volume Produzido Prata (Total Consolidado - ${getPeriodLabel(selectedPeriod)})`;
    const rows = parceiros
      .filter(p => p.status === 'Ativo')
      .map(p => ({
        ...p,
        volPrataPeriodo: (parceiroProdMap[p.id]?.total || 0) / numMonths
      }))
      .sort((a, b) => b.volPrataPeriodo - a.volPrataPeriodo);
    const totalPrata = rows.reduce((sum, p) => sum + p.volPrataPeriodo, 0);
    content = (
      <table className="table">
        <thead>
          <tr>
            <th>Parceiro (Ativo)</th>
            <th>Status</th>
            <th>Classificação</th>
            <th style={{ textAlign: 'right' }}>Volume Prata</th>
            <th style={{ textAlign: 'right' }}>Share na Carteira (%)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const share = totalPrata > 0 ? (p.volPrataPeriodo / totalPrata) * 100 : 0;
            return (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.nome}</td>
                <td>
                  <span className={`badge ${p.status === 'Ativo' ? 'badge-success' : p.status === 'Inativo' ? 'badge-danger' : p.status === 'Reativado' ? 'badge-warning' : 'badge-info'}`}>
                    {p.status}
                  </span>
                </td>
                <td>{p.classificacao}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--primary-color)' }}>{formatCurrency(p.volPrataPeriodo)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{share.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 800, backgroundColor: 'rgba(0, 0, 0, 0.05)' }}>
            <td colSpan={3}>Volume Total Produzido Prata</td>
            <td style={{ textAlign: 'right', color: 'var(--primary-color)' }}>
              {formatCurrency(totalPrata)}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    );
  } else if (kpiType === 'concentracao') {
    title = `Taxa de Concentração por Parceiro (${getPeriodLabel(selectedPeriod)})`;
    const rows = [...parceiros]
      .filter(p => p.vol_total_mensal > 0)
      .map(p => {
        const volPrataPeriodo = (parceiroProdMap[p.id]?.total || 0) / numMonths;
        const volTotalAjustado = Math.max(p.vol_total_mensal || 0, volPrataPeriodo);
        return {
          ...p,
          volPrataPeriodo,
          vol_total_mensal: volTotalAjustado,
          conc: volTotalAjustado > 0 ? (volPrataPeriodo / volTotalAjustado) * 100 : 0
        };
      })
      .sort((a, b) => b.conc - a.conc);
    content = (
      <table className="table">
        <thead>
          <tr>
            <th>Parceiro</th>
            <th style={{ textAlign: 'right' }}>Vol. Total Mercado</th>
            <th style={{ textAlign: 'right' }}>Vol. Prata</th>
            <th style={{ textAlign: 'right' }}>Concentração (%)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id}>
              <td style={{ fontWeight: 600 }}>{p.nome}</td>
              <td style={{ textAlign: 'right' }}>{formatCurrency(p.vol_total_mensal)}</td>
              <td style={{ textAlign: 'right' }}>{formatCurrency(p.volPrataPeriodo)}</td>
              <td style={{ textAlign: 'right', fontWeight: 600, color: p.conc >= 30 ? 'var(--danger)' : 'var(--success)' }}>
                {p.conc.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (kpiType === 'parceiros-ativos') {
    title = 'Parceiros Ativos na Carteira';
    const rows = parceiros
      .filter(p => p.status === 'Ativo')
      .map(p => ({
        ...p,
        volPrataPeriodo: (parceiroProdMap[p.id]?.total || 0) / numMonths
      }))
      .sort((a,b) => b.score_comercial - a.score_comercial);
    content = (
      <table className="table">
        <thead>
          <tr>
            <th>Parceiro</th>
            <th>Classificação</th>
            <th style={{ textAlign: 'center' }}>Score Comercial</th>
            <th>Modelo de Atuação</th>
            <th style={{ textAlign: 'right' }}>Volume Prata</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id}>
              <td style={{ fontWeight: 600 }}>{p.nome}</td>
              <td>{p.classificacao}</td>
              <td style={{ textAlign: 'center' }}>
                <span className={`badge ${p.score_comercial >= 80 ? 'badge-success' : p.score_comercial >= 50 ? 'badge-info' : 'badge-warning'}`}>
                  {p.score_comercial}
                </span>
              </td>
              <td>{p.modelo_atuacao}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(p.volPrataPeriodo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (kpiType === 'taxa-ativos') {
    title = 'Distribuição Geral do Status dos Parceiros';
    const statusCounts = parceiros.reduce((acc: any, p) => {
      acc[p.status] = (acc[p.status] || 0) + 1;
      return acc;
    }, {});
    const rows = [...parceiros].sort((a, b) => a.status.localeCompare(b.status));
    content = (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem', textAlign: 'center' }}>
          <div style={{ padding: '0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(16, 185, 129, 0.1)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ATIVOS</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--success)' }}>{statusCounts['Ativo'] || 0}</div>
          </div>
          <div style={{ padding: '0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ONBOARDING</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--info)' }}>{statusCounts['Onboarding'] || 0}</div>
          </div>
          <div style={{ padding: '0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>REATIVADO</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--warning)' }}>{statusCounts['Reativado'] || 0}</div>
          </div>
          <div style={{ padding: '0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>INATIVO</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--danger)' }}>{statusCounts['Inativo'] || 0}</div>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Parceiro</th>
              <th>Status</th>
              <th>Classificação</th>
              <th style={{ textAlign: 'center' }}>Score Comercial</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.nome}</td>
                <td>
                  <span className={`badge ${
                    p.status === 'Ativo' ? 'badge-success' :
                    p.status === 'Inativo' ? 'badge-danger' :
                    p.status === 'Reativado' ? 'badge-warning' : 'badge-info'
                  }`}>
                    {p.status}
                  </span>
                </td>
                <td>{p.classificacao}</td>
                <td style={{ textAlign: 'center' }}>{p.score_comercial}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (kpiType === 'churn') {
    title = 'Churn da Carteira (Parceiros Inativos)';
    const rows = parceiros.filter(p => p.status === 'Inativo').sort((a,b) => b.vol_total_mensal - a.vol_total_mensal);
    content = (
      <table className="table">
        <thead>
          <tr>
            <th>Parceiro</th>
            <th style={{ textAlign: 'right' }}>Último Faturamento Mercado</th>
            <th>Data de Cadastro</th>
            <th style={{ textAlign: 'center' }}>Score Comercial</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id}>
              <td style={{ fontWeight: 600, color: 'var(--danger)' }}>{p.nome}</td>
              <td style={{ textAlign: 'right' }}>{formatCurrency(p.vol_total_mensal)}</td>
              <td>{p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : 'N/A'}</td>
              <td style={{ textAlign: 'center' }}>{p.score_comercial}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (kpiType === 'media-produtos') {
    title = `Mix de Produtos Comercializados por Parceiro Ativo (${getPeriodLabel(selectedPeriod)})`;
    // Mesmo filtro do card de KPI: só parceiros Ativos no período, para o
    // detalhamento não contradizer o número exibido no card.
    const rows = parceiros
      .filter(p => p.status === 'Ativo')
      .map(p => {
        const ops = getProdutosOperados(p.id);
        return {
          ...p,
          produtosOperados: ops,
          volPrataPeriodo: (parceiroProdMap[p.id]?.total || 0) / numMonths
        };
      })
      .sort((a, b) => b.produtosOperados.length - a.produtosOperados.length);
    content = (
      <table className="table">
        <thead>
          <tr>
            <th>Parceiro</th>
            <th style={{ textAlign: 'center' }}>Qtd Produtos</th>
            <th>Produtos Ativos</th>
            <th style={{ textAlign: 'right' }}>Faturamento Prata</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id}>
              <td style={{ fontWeight: 600 }}>{p.nome}</td>
              <td style={{ textAlign: 'center', fontWeight: 700 }}>{p.produtosOperados.length}</td>
              <td>
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                  {p.produtosOperados.map(prod => (
                    <span key={prod} className="badge badge-success" style={{ fontSize: '0.65rem' }}>{prod}</span>
                  ))}
                  {p.produtosOperados.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Nenhum</span>}
                </div>
              </td>
              <td style={{ textAlign: 'right' }}>{formatCurrency(p.volPrataPeriodo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (kpiType === 'taxa-reativacao') {
    title = 'Origem: Taxa de Reativação da Carteira (Transição Inativo → Reativado)';
    content = loading ? (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Buscando contatos e históricos comerciais...</div>
    ) : (
      <table className="table">
        <thead>
          <tr>
            <th>Parceiro Win-back</th>
            <th>Situação de Base</th>
            <th>Transicionou no Período?</th>
            <th>Status Atual</th>
            <th>Classificação</th>
            <th style={{ textAlign: 'right' }}>Faturamento no Período</th>
          </tr>
        </thead>
        <tbody>
          {details.map((p, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{p.nome}</td>
              <td>{p.inicioWinback}</td>
              <td>
                <span className={`badge ${p.transicionou ? 'badge-success' : 'badge-danger'}`}>
                  {p.transicionou ? 'Sim' : 'Não'}
                </span>
              </td>
              <td>
                <span className={`badge ${
                  p.statusAtual === 'Ativo' ? 'badge-success' :
                  p.statusAtual === 'Inativo' ? 'badge-danger' :
                  p.statusAtual === 'Reativado' ? 'badge-warning' : 'badge-info'
                }`}>
                  {p.statusAtual}
                </span>
              </td>
              <td>{p.classificacao}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(p.volPrata)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(7, 12, 20, 0.7)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      zIndex: 1000,
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      paddingTop: '3rem',
      overflowY: 'auto'
    }}>
      <div className="card animate-scale" style={{
        width: '100%',
        maxWidth: '800px',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        backgroundColor: 'rgba(209, 250, 237, 0.95)',
        border: '1px solid rgba(15, 184, 130, 0.35)',
        boxShadow: 'var(--shadow-lg)',
        margin: '0 1rem 3rem'
      }}>
        {/* Cabeçalho */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--secondary-color)' }}>
              {title}
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
              Dados de auditoria extraídos diretamente das produções e logs do CRM.
            </p>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {/* Corpo com scroll */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          <div className="table-container" style={{ border: 'none', boxShadow: 'none', backdropFilter: 'none', background: 'transparent' }}>
            {content}
          </div>
        </div>

        {/* Rodapé */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-color)',
          backgroundColor: 'rgba(7, 12, 20, 0.4)',
          display: 'flex',
          justifyContent: 'flex-end',
          borderBottomLeftRadius: 'var(--radius-md)',
          borderBottomRightRadius: 'var(--radius-md)'
        }}>
          <button onClick={onClose} className="btn btn-primary" style={{ padding: '0.5rem 1.5rem' }}>
            Fechar Relatório
          </button>
        </div>
      </div>
    </div>
  );
}
