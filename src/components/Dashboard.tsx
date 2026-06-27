import { useEffect, useState } from 'react';
import { dataService, getMonthsForPeriod, getPeriodLabel } from '../services/dataService';
import { Parceiro, SemafaroStatus, CrmLog, ProducaoMensal, CriteriosConfig } from '../types';
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

  const prodsMap: { [key: string]: ProducaoMensal[] } = {};
  for (const prod of allProds) {
    if (!prodsMap[prod.parceiro_id]) {
      prodsMap[prod.parceiro_id] = [];
    }
    prodsMap[prod.parceiro_id].push(prod);
  }

  // Faturamento consolidado total no mês anterior (Maio/2026) por estar completo
  const faturamentoTotalPrataMai = pList.reduce((sum, p) => {
    const prods = prodsMap[p.id] || [];
    const prMai = prods.find(pr => pr.ano === 2026 && pr.mes === 5);
    const vol = prMai ? (prMai.vol_fgts || 0) + (prMai.vol_clt || 0) + (prMai.vol_cgv || 0) + (prMai.vol_pix || 0) : 0;
    return sum + vol;
  }, 0) || 1;

  for (const p of pList) {
    const logsParceiro = lList.filter(l => l.parceiro_id === p.id);
    const dataUltima = logsParceiro.length > 0 
      ? new Date(logsParceiro[0].data_contato) 
      : null;
    
    const producoes = prodsMap[p.id] || [];
    const prodMai = producoes.find(pr => pr.ano === 2026 && pr.mes === 5);
    const volPrataMai = prodMai ? (prodMai.vol_fgts || 0) + (prodMai.vol_clt || 0) + (prodMai.vol_cgv || 0) + (prodMai.vol_pix || 0) : 0;

    // Alerta A: Risco de Concentração Sistêmica (usando dados de Maio/2026)
    const sharePortfol = (volPrataMai / faturamentoTotalPrataMai) * 100;
    if (p.status === 'Ativo' && sharePortfol >= 30) {
      activeAlerts.push({
        id: 'alert_conc_sist_' + p.id,
        parceiro: p.nome,
        parceiroId: p.id,
        mensagem: `Risco de Concentração Sistêmica (Ref: Mai/26): O parceiro representou ${sharePortfol.toFixed(1)}% do faturamento consolidado do Prata Digital no mês anterior.`,
        prioridade: 'Alta',
        ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem registro'
      });
    }

    // Alerta B: Early Warning (comparando safra de Maio/2026 com Abril/2026 por estarem fechadas)
    const prodAbr = producoes.find(pr => pr.ano === 2026 && pr.mes === 4);
    
    if (p.status === 'Ativo' && prodMai && prodAbr) {
      const volAbr = (prodAbr.vol_fgts || 0) + (prodAbr.vol_clt || 0) + (prodAbr.vol_cgv || 0) + (prodAbr.vol_pix || 0);
      
      if (volAbr > 0) {
        const queda = ((volAbr - volPrataMai) / volAbr) * 100;
        if (queda >= 40) {
          activeAlerts.push({
            id: 'alert_early_warn_' + p.id,
            parceiro: p.nome,
            parceiroId: p.id,
            mensagem: `Early Warning (Queda Consolidada): Redução de ${queda.toFixed(1)}% no faturamento consolidado de Maio em relação a Abril (de R$ ${volAbr.toLocaleString('pt-BR')} para R$ ${volPrataMai.toLocaleString('pt-BR')}).`,
            prioridade: 'Alta',
            ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem registro'
          });
        }
      }
    }

    // Regra 1: Parceiro Estratégico sem contato há mais de 30 dias
    if (p.classificacao === 'Estratégico' && p.status === 'Ativo') {
      if (!dataUltima || (hoje.getTime() - dataUltima.getTime()) > (30 * 24 * 60 * 60 * 1000)) {
        activeAlerts.push({
          id: 'alert_strat_' + p.id,
          parceiro: p.nome,
          parceiroId: p.id,
          mensagem: 'Parceiro Estratégico sem nenhum contato registrado nos últimos 30 dias.',
          prioridade: 'Alta',
          ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem registro'
        });
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
          ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem contato'
        });
      }
    }

    // REGRA DE GESTÃO COMERCIAL: Parceiro migrado de Onboarding para Reativação por inatividade nos primeiros 7 dias (limite exatamente 30 dias)
    if (p.status === 'Reativação') {
      const dataCriacao = p.created_at ? new Date(p.created_at) : new Date();
      const diferencaCriacaoDias = (hoje.getTime() - dataCriacao.getTime()) / (1000 * 60 * 60 * 24);
      
      const temProducao = producoes.some(pr => {
        const vol = (pr.vol_fgts || 0) + (pr.vol_clt || 0) + (pr.vol_cgv || 0) + (pr.vol_pix || 0);
        return vol > 0;
      });

      if (diferencaCriacaoDias > 7 && diferencaCriacaoDias <= 30 && !temProducao) {
        const diasRestantes = Math.ceil(30 - diferencaCriacaoDias);
        activeAlerts.push({
          id: 'alert_onb_to_reat_' + p.id,
          parceiro: p.nome,
          parceiroId: p.id,
          mensagem: `Gestão Comercial: Parceiro migrado de Onboarding para Reativação por inatividade nos primeiros 7 dias. Alerta ativo por mais ${diasRestantes} dias enquanto não houver produção.`,
          prioridade: 'Alta',
          ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem contato'
        });
      }
    }

    // Regra 3: Parceiro com queda brusca de produção (Volume Prata = 0 ou em Reativação)
    if (p.status === 'Reativação' && p.vol_total_mensal > 0) {
      activeAlerts.push({
        id: 'alert_inactive_' + p.id,
        parceiro: p.nome,
        parceiroId: p.id,
        mensagem: 'Produção zerada há 60+ dias — processo Win-back deve ser iniciado.',
        prioridade: 'Alta',
        ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem registro'
      });
    }

    // Oportunidades (Prioridade Média)
    if (p.status === 'Ativo' && !p.produtos_ativos.includes('CGV') && p.num_vendedores >= 4) {
      activeAlerts.push({
        id: 'alert_opp_cgv_' + p.id,
        parceiro: p.nome,
        parceiroId: p.id,
        mensagem: 'Parceiro qualificado para expansão do produto CGV (ainda não ativado).',
        prioridade: 'Média',
        ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem registro'
      });
    }

    const shareMercadoMai = p.vol_total_mensal > 0 ? (volPrataMai / p.vol_total_mensal) : 0;
    if (p.status === 'Ativo' && p.vol_total_mensal > 150000 && shareMercadoMai < 0.25) {
      activeAlerts.push({
        id: 'alert_opp_conc_' + p.id,
        parceiro: p.nome,
        parceiroId: p.id,
        mensagem: `Concentração no Prata abaixo de 25% no mês de Maio (${(shareMercadoMai * 100).toFixed(0)}%) — grande volume de mercado captável.`,
        prioridade: 'Média',
        ultimaInteracao: dataUltima ? dataUltima.toLocaleDateString('pt-BR') : 'Sem registro'
      });
    }
  }

  return activeAlerts;
}

export default function Dashboard() {
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const [logs, setLogs] = useState<CrmLog[]>([]);
  const [allProducoes, setAllProducoes] = useState<ProducaoMensal[]>([]);
  const [semaforo, setSemaforo] = useState<SemafaroStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showImporter, setShowImporter] = useState(false);
  const [cicloAtivacao, setCicloAtivacao] = useState(6);
  const [taxaReativacao, setTaxaReativacao] = useState(25.0);
  const [selectedKpi, setSelectedKpi] = useState<string | null>(null);
  const [lastWeeklyUploadDate, setLastWeeklyUploadDate] = useState<string>('');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('maio_2026');
  const [criterios, setCriterios] = useState<CriteriosConfig | null>(null);

  // Alertas gerados dinamicamente
  const [alertas, setAlertas] = useState<{
    id: string;
    parceiro: string;
    parceiroId: string;
    mensagem: string;
    prioridade: 'Alta' | 'Média';
    ultimaInteracao?: string;
  }[]>([]);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        setLoading(true);
        const [pList, lList, allProds, config] = await Promise.all([
          dataService.getParceiros(),
          dataService.getLogs(),
          dataService.getAllProducao(),
          dataService.getCriterios()
        ]);

        const sem = await dataService.getSemafaroStatus(pList, lList);
        const ciclo = await dataService.getCicloAtivacaoHunter(pList, allProds);
        const reat = await dataService.getTaxaReativacao(pList, lList);
        const uploadDate = dataService.getLastWeeklyUploadDate();
        
        setParceiros(pList);
        setLogs(lList);
        setAllProducoes(allProds);
        setSemaforo(sem);
        setCicloAtivacao(ciclo);
        setTaxaReativacao(reat);
        setLastWeeklyUploadDate(uploadDate);
        setCriterios(config);

        const activeAlerts = gerarAlertasDinamicos(pList, lList, allProds);
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

  let totalVolPrataAcumulado = 0;
  let fgtsSum = 0;
  let cltSum = 0;
  let cgvSum = 0;
  let pixSum = 0;

  // Mapa de relacionamento parceiro_id -> faturamentos acumulados no período selecionado
  const parceiroProdMap: Record<string, { fgts: number; clt: number; cgv: number; pix: number; total: number }> = {};

  allProducoes.forEach(prod => {
    const match = activeMonths.some(m => m.ano === prod.ano && m.mes === prod.mes);
    if (match) {
      const vol = (prod.vol_fgts || 0) + (prod.vol_clt || 0) + (prod.vol_cgv || 0) + (prod.vol_pix || 0);
      totalVolPrataAcumulado += vol;
      fgtsSum += prod.vol_fgts || 0;
      cltSum += prod.vol_clt || 0;
      cgvSum += prod.vol_cgv || 0;
      pixSum += prod.vol_pix || 0;

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

  const totalVolumePrata = totalVolPrataAcumulado / numMonths;
  const mixProdutos = {
    fgts: fgtsSum / numMonths,
    clt: cltSum / numMonths,
    cgv: cgvSum / numMonths,
    pix: pixSum / numMonths
  };

  const totalVolumeMercado = parceirosNoPeriodo.reduce((sum, p) => sum + p.vol_total_mensal, 0);

  const concentracaoGlobal = totalVolumeMercado > 0 
    ? (totalVolumePrata / totalVolumeMercado) * 100
    : 0;

  let totalProdutosOperados = 0;
  parceirosNoPeriodo.forEach(p => {
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
  const mediaProdutos = parceirosNoPeriodo.length > 0 ? totalProdutosOperados / parceirosNoPeriodo.length : 0;

  const parceirosAtivos = parceirosNoPeriodo.filter(p => p.status === 'Ativo').length;
  const taxaAtivos = parceirosNoPeriodo.length > 0 ? (parceirosAtivos / parceirosNoPeriodo.length) * 100 : 0;
  const inativos = parceirosNoPeriodo.filter(p => p.status === 'Reativação').length;
  const churnRate = parceirosNoPeriodo.length > 0 ? (inativos / parceirosNoPeriodo.length) * 100 : 0;

  // Formatar Moeda
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(val);
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
              <option value="junho_2026">Junho/2026 (Mês Atual)</option>
              <option value="maio_2026">Maio/2026</option>
              <option value="abril_2026">Abril/2026</option>
              <option value="marco_2026">Março/2026</option>
              <option value="fevereiro_2026">Fevereiro/2026</option>
              <option value="janeiro_2026">Janeiro/2026</option>
              <option value="ultimos_3_meses">Últimos 3 meses (Média)</option>
              <option value="ultimos_6_meses">Últimos 6 meses (Média)</option>
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

      {/* Grid de KPIs Superiores (Volume e Concentração) */}
      <div className="dashboard-summary-grid" style={{ marginBottom: '1.5rem' }}>
        {/* KPI 1: Volume Total Mercado */}
        <div className="card kpi-card" onClick={() => setSelectedKpi('total-mercado')}>
          <div>
            <span className="kpi-label">Volume Total Mercado</span>
            <div className="kpi-value">{formatCurrency(totalVolumeMercado)}</div>
            <span className="kpi-meta" style={{ color: 'var(--text-muted)' }}>
              Média Mensal · {getPeriodLabel(selectedPeriod)}
            </span>
          </div>
          <div className="kpi-icon-container">
            <TrendingUp size={24} />
          </div>
        </div>

        {/* KPI 2: Volume Prata */}
        <div className="card kpi-card" onClick={() => setSelectedKpi('total-prata')}>
          <div>
            <span className="kpi-label">Volume Produzido Prata</span>
            <div className="kpi-value" style={{ color: 'var(--primary-color)' }}>{formatCurrency(totalVolumePrata)}</div>
            <span className="kpi-meta success" style={{ fontSize: '0.7rem' }}>
              Ref: {getPeriodLabel(selectedPeriod)}
            </span>
          </div>
          <div className="kpi-icon-container" style={{ color: 'var(--primary-color)', backgroundColor: 'rgba(15, 184, 130, 0.15)' }}>
            <TrendingUp size={24} />
          </div>
        </div>

        {/* KPI 3: Concentração Média */}
        <div className="card kpi-card" onClick={() => setSelectedKpi('concentracao')}>
          <div>
            <span className="kpi-label">Concentração Média Prata</span>
            <div className="kpi-value">{concentracaoGlobal.toFixed(1)}%</div>
            <span className={`kpi-meta ${concentracaoGlobal >= 30 ? 'success' : 'danger'}`}>
              Meta: &ge; 30% ({getPeriodLabel(selectedPeriod)})
            </span>
          </div>
          <div className="kpi-icon-container">
            <Layers size={24} />
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
            <span className={`kpi-meta ${taxaAtivos >= 70 ? 'success' : 'danger'}`}>Meta: &ge; 70% (Fixo atual)</span>
          </div>
          <div className="kpi-icon-container">
            <Percent size={24} />
          </div>
        </div>

        {/* KPI 6: Churn da Carteira */}
        <div className="card kpi-card" 
             style={{ borderLeft: churnRate >= 10 ? '4px solid var(--danger)' : '1px solid var(--border-color)' }}
             onClick={() => setSelectedKpi('churn')}>
          <div>
            <span className="kpi-label">Churn da Carteira</span>
            <div className="kpi-value" style={{ color: churnRate >= 10 ? 'var(--danger)' : 'inherit' }}>{churnRate.toFixed(1)}%</div>
            <span className={`kpi-meta ${churnRate < 10 ? 'success' : 'danger'}`}>Meta: &lt; 10% (Fixo atual)</span>
          </div>
          <div className="kpi-icon-container" style={{ color: 'var(--danger)', backgroundColor: 'rgba(239, 68, 68, 0.15)' }}>
            <AlertCircle size={24} />
          </div>
        </div>
      </div>

      {/* Grid de KPIs Auxiliares (Demais Métricas) */}
      <div className="dashboard-summary-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: '2rem' }}>
        <div className="card kpi-card" style={{ padding: '1rem 1.25rem' }} onClick={() => setSelectedKpi('media-produtos')}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>MÉDIA PRODUTOS</span>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--secondary-color)', margin: '0.2rem 0' }}>
            {mediaProdutos.toFixed(1)}
          </div>
          <span style={{ fontSize: '0.7rem', color: mediaProdutos >= 2 ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>
            Meta: &ge; 2 ({getPeriodLabel(selectedPeriod)})
          </span>
        </div>

        <div className="card kpi-card" style={{ padding: '1rem 1.25rem' }} onClick={() => setSelectedKpi('ciclo-ativacao')}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>CICLO ATIVAÇÃO HUNTER</span>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--secondary-color)', margin: '0.2rem 0' }}>
            {cicloAtivacao} dias
          </div>
          <span style={{ fontSize: '0.7rem', color: cicloAtivacao <= 7 ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>Meta: &le; 7 dias</span>
        </div>

        <div className="card kpi-card" style={{ padding: '1rem 1.25rem' }} onClick={() => setSelectedKpi('taxa-reativacao')}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>TAXA REATIVAÇÃO</span>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--secondary-color)', margin: '0.2rem 0' }}>
            {taxaReativacao.toFixed(1)}%
          </div>
          <span style={{ fontSize: '0.7rem', color: taxaReativacao >= 25 ? 'var(--success)' : 'var(--danger)', fontWeight: 500 }}>Meta: &ge; 25%</span>
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
            {/* Hunter */}
            <div className={`card semaforo-card ${semaforo.hunter}`}>
              <div className="semaforo-header">
                <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>PROSPECÇÃO / HUNTER</span>
                <div className="semaforo-indicator">
                  <span className={`semaforo-dot ${semaforo.hunter}`}></span>
                  <span style={{ color: semaforo.hunter === 'Verde' ? 'var(--success)' : 'var(--danger)' }}>{semaforo.hunter}</span>
                </div>
              </div>
              <div style={{ margin: '1rem 0' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Meta Semanal:</span>
                <p style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--secondary-color)' }}>
                  2 novos parceiros ativados OU 1 nova reativação (win-back)
                </p>
              </div>
              <div style={{ padding: '0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                <strong>Recomendação:</strong> {semaforo.hunterAcao}
              </div>
            </div>

            {/* Farmer */}
            <div className={`card semaforo-card ${semaforo.farmer}`}>
              <div className="semaforo-header">
                <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>CARTEIRA / FARMER</span>
                <div className="semaforo-indicator">
                  <span className={`semaforo-dot ${semaforo.farmer}`}></span>
                  <span style={{ color: semaforo.farmer === 'Verde' ? 'var(--success)' : 'var(--danger)' }}>{semaforo.farmer}</span>
                </div>
              </div>
              <div style={{ margin: '1rem 0' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Meta Semanal:</span>
                <p style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--secondary-color)' }}>
                  1200 propostas pagas na carteira
                </p>
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
            {alertas.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '2rem 0' }}>
                Nenhum alerta ativo! Toda a carteira está em dia com as cadências.
              </p>
            ) : (
              alertas.map(alert => (
                <div key={alert.id} className={`alert-item ${alert.prioridade}`}>
                  <div className="alert-body">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--secondary-color)' }}>
                        {alert.parceiro}
                      </span>
                      <span className={`badge ${alert.prioridade === 'Alta' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: '0.65rem' }}>
                        {alert.prioridade}
                      </span>
                    </div>
                    <p className="alert-text" style={{ marginTop: '0.35rem', fontWeight: 550 }}>{alert.mensagem}</p>
                    <div className="alert-meta">
                      <span>Último Contato: {alert.ultimaInteracao}</span>
                    </div>
                  </div>
                </div>
              ))
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
                    const conc = p.vol_total_mensal > 0 ? (p.volPrataPeriodo / p.vol_total_mensal) * 100 : 0;
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
                          {conc.toFixed(0)}%
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
              const [pList, lList, allProds] = await Promise.all([
                dataService.getParceiros(),
                dataService.getLogs(),
                dataService.getAllProducao()
              ]);

              const sem = await dataService.getSemafaroStatus(pList, lList);
              const ciclo = await dataService.getCicloAtivacaoHunter(pList, allProds);
              const reat = await dataService.getTaxaReativacao(pList, lList);
              
              setParceiros(pList);
              setLogs(lList);
              setAllProducoes(allProds);
              setCicloAtivacao(ciclo);
              setTaxaReativacao(reat);
              setSemaforo(sem);

              // Atualizar alertas
              const activeAlerts = gerarAlertasDinamicos(pList, lList, allProds);
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
    if (kpiType === 'ciclo-ativacao') {
      setLoading(true);
      async function calc() {
        try {
          const list: any[] = [];
          const prodsMap: { [key: string]: ProducaoMensal[] } = {};
          for (const pr of allProducoes) {
            if (!prodsMap[pr.parceiro_id]) {
              prodsMap[pr.parceiro_id] = [];
            }
            prodsMap[pr.parceiro_id].push(pr);
          }

          for (const p of parceiros) {
            const prods = prodsMap[p.id] || [];
            const comProd = prods.filter(pr => ((pr.vol_fgts || 0) + (pr.vol_clt || 0) + (pr.vol_cgv || 0) + (pr.vol_pix || 0)) > 0);
            if (comProd.length > 0) {
              const sorted = [...comProd].sort((a,b) => (a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes));
              const primeira = sorted[0];
              const dataPrimeira = new Date(primeira.ano, primeira.mes - 1, 15);
              const dataCriacao = p.created_at ? new Date(p.created_at) : new Date(2026, 4, 1);
              const diffTempo = dataPrimeira.getTime() - dataCriacao.getTime();
              const dias = Math.max(1, Math.round(diffTempo / (1000 * 60 * 60 * 24)));
              list.push({
                nome: p.nome,
                criacao: dataCriacao.toLocaleDateString('pt-BR'),
                primeiraProd: `${primeira.mes < 10 ? '0' + primeira.mes : primeira.mes}/${primeira.ano}`,
                vol: (primeira.vol_fgts || 0) + (primeira.vol_clt || 0) + (primeira.vol_cgv || 0) + (primeira.vol_pix || 0),
                dias
              });
            }
          }
          setDetails(list.sort((a,b) => a.dias - b.dias));
        } catch (e) {
          console.error(e);
        } finally {
          setLoading(false);
        }
      }
      calc();
    } else if (kpiType === 'taxa-reativacao') {
      setLoading(true);
      async function calc() {
        try {
          const winbackSet = new Set<string>();
          const datasInicio: Record<string, string> = {};
          allLogs.forEach(log => {
            if (log.processo === 'Win-back') {
              winbackSet.add(log.parceiro_id);
              if (!datasInicio[log.parceiro_id]) {
                datasInicio[log.parceiro_id] = new Date(log.data_contato).toLocaleDateString('pt-BR');
              }
            }
          });
          const list = parceiros
            .filter(p => winbackSet.has(p.id))
            .map(p => ({
              nome: p.nome,
              status: p.status,
              classificacao: p.classificacao,
              score: p.score_comercial,
              inicioWinback: datasInicio[p.id] || 'N/A',
              volPrata: (parceiroProdMap[p.id]?.total || 0) / numMonths
            }));
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
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(val);
  };

  // Renderizar o cabeçalho e dados de acordo com o KPI
  let title = '';
  let content = null;

  if (kpiType === 'total-mercado') {
    title = `Detalhamento do Volume de Mercado (Faturamento Mensal Geral - ${getPeriodLabel(selectedPeriod)})`;
    const rows = [...parceiros].sort((a, b) => b.vol_total_mensal - a.vol_total_mensal);
    content = (
      <table className="table">
        <thead>
          <tr>
            <th>Parceiro</th>
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
                <span className={`badge ${p.status === 'Ativo' ? 'badge-success' : p.status === 'Reativação' ? 'badge-danger' : 'badge-info'}`}>
                  {p.status}
                </span>
              </td>
              <td>{p.classificacao}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(p.vol_total_mensal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (kpiType === 'total-prata') {
    title = `Detalhamento do Volume Produzido Prata (${getPeriodLabel(selectedPeriod)})`;
    const rows = parceiros
      .map(p => ({
        ...p,
        volPrataPeriodo: (parceiroProdMap[p.id]?.total || 0) / numMonths
      }))
      .sort((a, b) => b.volPrataPeriodo - a.volPrataPeriodo);
    const totalPrata = rows.reduce((sum, p) => sum + p.volPrataPeriodo, 0) || 1;
    content = (
      <table className="table">
        <thead>
          <tr>
            <th>Parceiro</th>
            <th>Status</th>
            <th>Classificação</th>
            <th style={{ textAlign: 'right' }}>Volume Prata</th>
            <th style={{ textAlign: 'right' }}>Share na Carteira (%)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const share = (p.volPrataPeriodo / totalPrata) * 100;
            return (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.nome}</td>
                <td>
                  <span className={`badge ${p.status === 'Ativo' ? 'badge-success' : p.status === 'Reativação' ? 'badge-danger' : 'badge-info'}`}>
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
      </table>
    );
  } else if (kpiType === 'concentracao') {
    title = `Taxa de Concentração Média por Parceiro (${getPeriodLabel(selectedPeriod)})`;
    const rows = [...parceiros]
      .filter(p => p.vol_total_mensal > 0)
      .map(p => {
        const volPrataPeriodo = (parceiroProdMap[p.id]?.total || 0) / numMonths;
        return {
          ...p,
          volPrataPeriodo,
          conc: (volPrataPeriodo / p.vol_total_mensal) * 100
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem', textAlign: 'center' }}>
          <div style={{ padding: '0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(16, 185, 129, 0.1)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ATIVOS</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--success)' }}>{statusCounts['Ativo'] || 0}</div>
          </div>
          <div style={{ padding: '0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(59, 130, 246, 0.1)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ONBOARDING</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--info)' }}>{statusCounts['Onboarding'] || 0}</div>
          </div>
          <div style={{ padding: '0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>REATIVAÇÃO</span>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--danger)' }}>{statusCounts['Reativação'] || 0}</div>
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
                    p.status === 'Reativação' ? 'badge-danger' : 'badge-info'
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
    title = 'Churn da Carteira (Parceiros em Reativação)';
    const rows = parceiros.filter(p => p.status === 'Reativação').sort((a,b) => b.vol_total_mensal - a.vol_total_mensal);
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
    title = `Mix de Produtos Comercializados por Parceiro (${getPeriodLabel(selectedPeriod)})`;
    const rows = [...parceiros]
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
  } else if (kpiType === 'ciclo-ativacao') {
    title = 'Origem: Ciclo de Ativação Hunter (Dias para Primeira Produção)';
    content = loading ? (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Processando faturamentos históricos...</div>
    ) : (
      <table className="table">
        <thead>
          <tr>
            <th>Parceiro Hunter</th>
            <th>Data de Cadastro</th>
            <th>Mês Primeira Produção</th>
            <th style={{ textAlign: 'right' }}>Faturamento Inicial</th>
            <th style={{ textAlign: 'center' }}>Dias para Ativação</th>
          </tr>
        </thead>
        <tbody>
          {details.map((p, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{p.nome}</td>
              <td>{p.criacao}</td>
              <td>{p.primeiraProd}</td>
              <td style={{ textAlign: 'right' }}>{formatCurrency(p.vol)}</td>
              <td style={{ textAlign: 'center', fontWeight: 700, color: p.dias <= 7 ? 'var(--success)' : 'var(--warning)' }}>{p.dias} dias</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (kpiType === 'taxa-reativacao') {
    title = 'Origem: Taxa de Reativação da Carteira (Processo Win-back)';
    content = loading ? (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Buscando contatos e históricos comerciais...</div>
    ) : (
      <table className="table">
        <thead>
          <tr>
            <th>Parceiro Win-back</th>
            <th>Início Win-back</th>
            <th>Status Atual</th>
            <th>Classificação</th>
            <th style={{ textAlign: 'right' }}>Faturamento Atual</th>
          </tr>
        </thead>
        <tbody>
          {details.map((p, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{p.nome}</td>
              <td>{p.inicioWinback}</td>
              <td>
                <span className={`badge ${p.status === 'Ativo' ? 'badge-success' : 'badge-danger'}`}>
                  {p.status === 'Ativo' ? 'Reativado' : 'Pendente de Reativação'}
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
