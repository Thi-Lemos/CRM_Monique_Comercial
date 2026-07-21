import React, { useEffect, useState } from 'react';
import { dataService } from '../services/dataService';
import { calculateCriteriaNotes } from '../services/scoreCalculator';
import { Parceiro, ProducaoMensal, CrmLog, ProducaoSemanal } from '../types';
import { 
  ArrowLeft, 
  MessageSquare,
  Plus,
  Edit,
  X,
  Settings,
  TrendingUp,
  CalendarDays,
  History,
  Trash2,
  Save,
  ChevronDown,
  ChevronRight as ChevronRightIcon
} from 'lucide-react';
import PartnerFormModal from './PartnerFormModal';
import WeekSelector from './WeekSelector';
import { getCurrentWeek, WeekInfo, fmtDateBR } from '../utils/weekUtils';
import CurrencyInput from './CurrencyInput';

interface PartnerDetailProps {
  partnerId: string;
  onBack: () => void;
  onNewLog: (partnerId: string) => void;
}

export default function PartnerDetail({ partnerId, onBack, onNewLog }: PartnerDetailProps) {
  const [partner, setPartner] = useState<Parceiro | null>(null);
  const [producao, setProducao] = useState<ProducaoMensal[]>([]);
  const [logs, setLogs] = useState<CrmLog[]>([]);
  const [semanas, setSemanas] = useState<ProducaoSemanal[]>([]);
  const [sharePortfolio, setSharePortfolio] = useState(0);
  const [volPrataAtual, setVolPrataAtual] = useState(0);
  const [loading, setLoading] = useState(true);

  // Form de lançamento de Produção Semanal (substitui o mensal antigo)
  const [showSemanalForm, setShowSemanalForm] = useState(false);
  const [semanalWeek, setSemanalWeek] = useState<WeekInfo>(getCurrentWeek());
  const [semanalForm, setSemanalForm] = useState({ vol_fgts: 0, vol_clt: 0, vol_cgv: 0, vol_pix: 0, propostas_pagas: 0 });
  const [semanalUpsertWarning, setSemanalUpsertWarning] = useState(false);

  // Inline editing de semana
  const [editingSemanaId, setEditingSemanaId] = useState<string | null>(null);
  const [editSemanaForm, setEditSemanaForm] = useState({ vol_fgts: 0, vol_clt: 0, vol_cgv: 0, vol_pix: 0, propostas_pagas: 0 });

  // Inline editing de registro mensal legado
  const [editingLegadoId, setEditingLegadoId] = useState<string | null>(null);
  const [editLegadoForm, setEditLegadoForm] = useState({ vol_fgts: 0, vol_clt: 0, vol_cgv: 0, vol_pix: 0, propostas_pagas: 0 });

  // Controle de expansão de meses no histórico unificado
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  // Estado para Edição do Parceiro
  const [isFormOpen, setIsFormOpen] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const partnersList = await dataService.getParceiros();
      const current = partnersList.find(p => p.id === partnerId);
      
      if (current) {
        setPartner(current);
        const prodData = await dataService.getProducao(partnerId);
        setProducao(prodData);
        // Vol. Prata Mês Anterior = produção do mês imediatamente anterior ao atual (fechado).
        // Calculado aqui a partir de prodData para evitar depender do campo vol_prata_mensal
        // do banco (desatualizado) ou de getVolPrataUltimaProducao (que pega o mais recente,
        // podendo ser o mês corrente ainda em aberto).
        const hoje = new Date();
        const mesAntRef = { ano: hoje.getFullYear(), mes: hoje.getMonth() }; // getMonth() já é 0-based → mês anterior
        if (mesAntRef.mes === 0) { mesAntRef.mes = 12; mesAntRef.ano -= 1; }
        const prodMesAnt = prodData.find(pr => Number(pr.ano) === mesAntRef.ano && Number(pr.mes) === mesAntRef.mes);
        setVolPrataAtual(prodMesAnt
          ? (prodMesAnt.vol_fgts || 0) + (prodMesAnt.vol_clt || 0) + (prodMesAnt.vol_cgv || 0) + (prodMesAnt.vol_pix || 0)
          : 0);
        const logData = await dataService.getLogs(partnerId);
        // Histórico de Interações Comerciais mostra apenas contatos registrados manualmente
        // pela Monique; transições automáticas de status (origem 'sistema') não entram aqui,
        // mas continuam contando para os KPIs de Hunter que dependem delas.
        setLogs(logData.filter(l => l.origem !== 'sistema'));

        // Produção Semanal
        const semanasData = await dataService.getProducoesSemanais(partnerId);
        setSemanas(semanasData);

        // Participação na carteira total do Prata
        // vol_prata_mensal vem do banco como string (coluna numeric) — coerce para number.
        const totalPrataGlobal = partnersList.reduce((sum, p) => sum + (Number(p.vol_prata_mensal) || 0), 0) || 1;
        setSharePortfolio(((Number(current.vol_prata_mensal) || 0) / totalPrataGlobal) * 100);
      }
    } catch (e) {
      console.error('Erro ao ler detalhes do parceiro:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [partnerId]);

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', fontSize: '1.1rem', fontWeight: 550 }}>Carregando ficha do parceiro...</div>;
  }

  if (!partner) {
    return (
      <div className="card fade-in" style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Parceiro não encontrado.</p>
        <button className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={onBack}>Voltar</button>
      </div>
    );
  }

  // Notas de Critérios do Score
  // vol_prata_mensal para o score deve ser o do mês anterior fechado (volPrataAtual),
  // não o valor bruto do banco que pode estar desatualizado.
  const notes = calculateCriteriaNotes({ ...partner, vol_prata_mensal: volPrataAtual });

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  };

  const openEditModal = () => { setIsFormOpen(true); };

  // ── Lançamento de produção semanal manual ─────────────────────────────────
  const handleSemanalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partner) return;
    setSemanalUpsertWarning(false);
    try {
      const saved = await dataService.saveProducaoSemanal({
        parceiro_id: partner.id,
        semana_inicio: semanalWeek.inicio,
        origem_entrada: 'manual',
        ...semanalForm
      });
      // Se o registro já existia (upsert), avisar o usuário
      if (saved.origem_entrada === 'manual' &&
          (saved.vol_fgts !== semanalForm.vol_fgts || saved.vol_clt !== semanalForm.vol_clt)) {
        setSemanalUpsertWarning(true);
      }
      setShowSemanalForm(false);
      setSemanalForm({ vol_fgts: 0, vol_clt: 0, vol_cgv: 0, vol_pix: 0, propostas_pagas: 0 });
      await loadData();
    } catch (e) { console.error(e); }
  };

  // ── Edição inline de semana ───────────────────────────────────────────────
  const startEditSemana = (s: ProducaoSemanal) => {
    setEditingSemanaId(s.id || null);
    setEditSemanaForm({ vol_fgts: s.vol_fgts || 0, vol_clt: s.vol_clt || 0, vol_cgv: s.vol_cgv || 0, vol_pix: s.vol_pix || 0, propostas_pagas: s.propostas_pagas || 0 });
  };
  const cancelEditSemana = () => { setEditingSemanaId(null); setEditSemanaForm({ vol_fgts: 0, vol_clt: 0, vol_cgv: 0, vol_pix: 0, propostas_pagas: 0 }); };
  const saveEditSemana = async (s: ProducaoSemanal) => {
    if (!s.id) return;
    try {
      await dataService.updateProducaoSemanal(s.id, editSemanaForm);
      setEditingSemanaId(null);
      await loadData();
    } catch (e) { console.error('Erro ao atualizar semana:', e); }
  };
  const deleteSemana = async (s: ProducaoSemanal) => {
    const isLastWeek = semanas.filter(w => w.ano === s.ano && w.mes === s.mes).length === 1;
    const msg = isLastWeek
      ? `Excluir a última semana de ${s.mes.toString().padStart(2,'0')}/${s.ano}? O registro mensal também será removido permanentemente.`
      : `Excluir a produção da semana ${s.semana_inicio ? fmtDateBR(s.semana_inicio) : `Sem. ${s.semana}`}? O total do mês será recalculado.`;
    if (!window.confirm(msg)) return;
    try {
      await dataService.deleteProducaoSemanal(s.id!, partner!.id, s.ano, s.mes);
      await loadData();
    } catch (e) { console.error('Erro ao excluir semana:', e); }
  };

  // ── Edição/exclusão de registro mensal legado ─────────────────────────────
  const startEditLegado = (p: ProducaoMensal) => {
    setEditingLegadoId(p.id || null);
    setEditLegadoForm({ vol_fgts: p.vol_fgts || 0, vol_clt: p.vol_clt || 0, vol_cgv: p.vol_cgv || 0, vol_pix: p.vol_pix || 0, propostas_pagas: p.propostas_pagas || 0 });
  };
  const cancelEditLegado = () => { setEditingLegadoId(null); setEditLegadoForm({ vol_fgts: 0, vol_clt: 0, vol_cgv: 0, vol_pix: 0, propostas_pagas: 0 }); };
  const saveLegado = async (p: ProducaoMensal) => {
    if (!p.id) return;
    try {
      await dataService.updateProducaoMensal(p.id, editLegadoForm);
      setEditingLegadoId(null);
      await loadData();
    } catch (e) { console.error('Erro ao atualizar legado:', e); }
  };
  const deleteLegado = async (p: ProducaoMensal) => {
    if (!window.confirm(`Excluir o registro de ${p.mes.toString().padStart(2,'0')}/${p.ano} permanentemente? Esta ação não pode ser desfeita.`)) return;
    try {
      await dataService.deleteProducaoMensal(p.id!, partner!.id, p.ano, p.mes);
      await loadData();
    } catch (e) { console.error('Erro ao excluir legado:', e); }
  };

  const toggleMonth = (key: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <div className="fade-in">
      {/* Botão de Voltar */}
      <button 
        onClick={onBack}
        className="btn btn-secondary"
        style={{ marginBottom: '1.5rem', padding: '0.5rem 1rem' }}
      >
        <ArrowLeft size={16} /> Voltar à Carteira
      </button>

      {/* Cabeçalho da Ficha do Parceiro */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--secondary-color)' }}>{partner.nome}</h2>
              <span className={`badge ${
                partner.status === 'Ativo' ? 'badge-success' : 
                partner.status === 'Inativo' ? 'badge-danger' :
                partner.status === 'Reativado' ? 'badge-warning' : 'badge-info'
              }`} style={{ fontSize: '0.7rem' }}>
                {partner.status}
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              CNPJ: {partner.cnpj} · Atuação: {partner.modelo_atuacao} ({partner.area_geografica})
            </p>
            {partner.status === 'Onboarding' && partner.created_at && (() => {
              const cadastro = new Date(partner.created_at);
              const vencimento = new Date(cadastro.getTime() + 7 * 24 * 60 * 60 * 1000);
              const vencimentoStr = vencimento.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
              return (
                <p style={{ fontSize: '0.8rem', marginTop: '0.2rem', color: 'var(--text-muted)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--info, #38bdf8)' }}>Data de cadastro:</span>{' '}
                  {cadastro.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  {' · '}
                  em Onboarding até {vencimentoStr}
                </p>
              );
            })()}
          </div>
          
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn btn-secondary" onClick={openEditModal} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Edit size={16} /> Editar Parceiro
            </button>
            <button className="btn btn-primary" onClick={() => onNewLog(partner.id)}>
              <MessageSquare size={16} /> Registrar Reunião / Contato
            </button>
          </div>
        </div>

        {/* Ficha Rápida */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1.5rem',
          borderTop: '1px solid var(--border-color)',
          marginTop: '1.5rem',
          paddingTop: '1.5rem'
        }}>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>CONTATO PRINCIPAL</span>
            <p style={{ fontWeight: 650, color: 'var(--secondary-color)', fontSize: '0.95rem', marginTop: '0.15rem' }}>{partner.contato_principal}</p>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>VOL. PRATA MÊS ANTERIOR</span>
            <p style={{ fontWeight: 700, color: 'var(--primary-color)', fontSize: '1.1rem', marginTop: '0.15rem' }}>{formatCurrency(volPrataAtual)}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>de {formatCurrency(partner.vol_total_mercado)}</p>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>PARTICIPAÇÃO CARTEIRA</span>
            <p style={{ 
              fontWeight: 700, 
              color: sharePortfolio >= 30 ? 'var(--danger)' : 'var(--secondary-color)', 
              fontSize: '1.1rem', 
              marginTop: '0.15rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}>
              {sharePortfolio.toFixed(1)}%
              {sharePortfolio >= 30 && (
                <span className="badge badge-danger" style={{ fontSize: '0.55rem', padding: '0.1rem 0.3rem', fontWeight: 700 }} title="Risco sistêmico de faturamento (>30%)">RISCO</span>
              )}
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>no faturamento total Prata</p>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>CONCENTRAÇÃO PRATA</span>
            <p style={{ fontWeight: 700, color: 'var(--secondary-color)', fontSize: '1.1rem', marginTop: '0.15rem' }}>
              {partner.vol_total_mercado > 0 ? `${Math.min((volPrataAtual / partner.vol_total_mercado) * 100, 100).toFixed(0)}%` : 'NVT'}
            </p>
            {partner.vol_total_mercado > 0 ? (
              <span className={`badge ${(volPrataAtual / partner.vol_total_mercado) >= 0.3 ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', marginTop: '0.1rem' }}>
                {(volPrataAtual / partner.vol_total_mercado) >= 0.3 ? 'Verde' : 'Abaixo Meta (30%)'}
              </span>
            ) : (
              <span className="badge badge-warning" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', marginTop: '0.1rem' }}>
                Necessita de Vol. Total (NVT)
              </span>
            )}
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>PRODUTOS ATIVOS</span>
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
              {(partner.produtos_ativos || []).map(p => (
                <span key={p} className="badge badge-info" style={{ fontSize: '0.65rem', padding: '0.15rem 0.45rem' }}>{p}</span>
              ))}
              {(partner.produtos_ativos || []).length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nenhum ativo</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Descrição do Parceiro */}
      {partner.descricao && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 className="card-title" style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>
            Descrição do Parceiro
          </h3>
          <p style={{ color: 'var(--text-main)', lineHeight: '1.7', whiteSpace: 'pre-wrap', margin: 0, fontSize: '0.92rem' }}>
            {partner.descricao}
          </p>
        </div>
      )}

      {/* Grid de Duas Colunas: Score / Produção */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1rem', marginBottom: '1.5rem', alignItems: 'start' }}>
        
        {/* Bloco do Score Comercial */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 className="card-title" style={{ justifyContent: 'space-between', fontSize: '1rem', marginBottom: '0.75rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Settings size={18} /> Detalhamento do Score Comercial
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className={`badge ${partner.score_comercial >= 80 ? 'badge-success' : partner.score_comercial >= 50 ? 'badge-info' : 'badge-warning'}`} style={{ fontSize: '0.85rem', padding: '0.25rem 0.5rem' }}>
                {partner.score_comercial} / 100
              </span>
            </div>
          </h3>

          <div style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(15, 23, 42, 0.4)', border: '1px solid var(--border-color)' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Classificação Atual:</p>
            <p style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--secondary-color)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.1rem' }}>
              {partner.classificacao === 'Estratégico' ? '⭐ Estratégico' : partner.classificacao === 'Crescimento' ? '🔼 Crescimento' : '🛠️ Desenvolvimento'}
            </p>
            <p style={{ fontSize: '0.75rem', fontWeight: 550, color: 'var(--text-main)', marginTop: '0.4rem' }}>
              <strong>Estratégia:</strong> {
                partner.classificacao === 'Estratégico' ? 'Retenção ativa + expansão de produtos' :
                partner.classificacao === 'Crescimento' ? 'Inclusão de produtos + aumento de concentração' :
                'Diagnóstico + plano de aceleração e desenvolvimento de equipe'
              }
            </p>
          </div>

          <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notas por Critério (Pesos)</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {[
              { label: 'Volume total do Mercado (25%)', note: notes.n1, desc: 'Declarado' },
              { label: 'Concentração atual no Prata (20%)', note: notes.n2, desc: partner.vol_total_mercado > 0 ? `${Math.min((volPrataAtual / partner.vol_total_mercado) * 100, 100).toFixed(0)}%` : 'NVT' },
              { label: 'Estrutura / Nº Vendedores (15%)', note: notes.n3, desc: `${partner.num_vendedores || 0} vend.` },
              { label: 'Abrangência geográfica (15%)', note: notes.n4, desc: partner.area_geografica || 'Local' },
              { label: 'Produtos ativos no Prata (10%)', note: notes.n5, desc: `${(partner.produtos_ativos || []).length} prod.` },
              { label: 'Modelo de atuação (10%)', note: notes.n6, desc: partner.modelo_atuacao || 'Físico' },
              { label: 'Risco de dependência de produto único (5%)', note: notes.n7, desc: `${(partner.produtos_ativos || []).length} prod.` }
            ].map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', paddingBottom: '0.35rem', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>{c.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({c.desc})</span>
                  <span style={{ fontWeight: 700, color: 'var(--secondary-color)', backgroundColor: 'rgba(255, 255, 255, 0.05)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    {c.note}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Histórico de Produção Unificado ────────────────────────────── */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 className="card-title" style={{ justifyContent: 'space-between', fontSize: '1rem', marginBottom: '0.75rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={18} /> Histórico de Produção
            </span>
            <button className="btn btn-secondary" style={{ padding: '0.35rem 0.65rem', fontSize: '0.725rem' }}
              onClick={() => { setSemanalForm({ vol_fgts: 0, vol_clt: 0, vol_cgv: 0, vol_pix: 0, propostas_pagas: 0 }); setSemanalWeek(getCurrentWeek()); setShowSemanalForm(true); }}>
              <Plus size={12} /> Registrar Semana
            </button>
          </h3>

          {(() => {
            const mesesComSemanas = new Set<string>();
            semanas.forEach(s => mesesComSemanas.add(`${s.ano}-${s.mes}`));

            const semanasPorMes: Record<string, ProducaoSemanal[]> = {};
            semanas.forEach(s => {
              const k = `${s.ano}-${s.mes}`;
              if (!semanasPorMes[k]) semanasPorMes[k] = [];
              semanasPorMes[k].push(s);
            });
            Object.values(semanasPorMes).forEach(arr => arr.sort((a, b) => (a.semana || 0) - (b.semana || 0)));

            const mesesOrdenados = [...producao].sort((a, b) =>
              b.ano !== a.ano ? b.ano - a.ano : b.mes - a.mes);

            const chavesMensal = new Set(producao.map(p => `${p.ano}-${p.mes}`));
            const mesesSoComSemanas = [...mesesComSemanas]
              .filter(k => !chavesMensal.has(k))
              .sort((a, b) => {
                const [aA, aM] = a.split('-').map(Number);
                const [bA, bM] = b.split('-').map(Number);
                return bA !== aA ? bA - aA : bM - aM;
              });

            const NOMES_MES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

            const thStyle: React.CSSProperties = {
              backgroundColor: 'var(--secondary-color)', color: '#fff',
              borderBottom: '1px solid rgba(255,255,255,0.15)', padding: '0.45rem 0.4rem',
              fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' as const
            };

            const renderSemanaRow = (s: ProducaoSemanal) => {
              const isEditing = editingSemanaId === s.id;
              const fim = s.semana_inicio
                ? new Date(new Date(s.semana_inicio + 'T12:00:00Z').getTime() + 6*86400000).toISOString().slice(0,10)
                : null;
              const periodo = s.semana_inicio && fim
                ? `${fmtDateBR(s.semana_inicio)} → ${fmtDateBR(fim)}`
                : `Sem. ${s.semana}`;

              if (isEditing) {
                return (
                  <tr key={s.id} style={{ backgroundColor: 'rgba(15,184,130,0.06)' }}>
                    <td style={{ padding: '0.4rem', fontSize: '0.72rem', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontStyle: 'italic' }}>{periodo}</td>
                    {(['vol_fgts','vol_clt','vol_cgv','vol_pix'] as const).map(field => (
                      <td key={field} style={{ padding: '0.25rem 0.3rem', textAlign: 'right' }}>
                        <CurrencyInput
                          value={editSemanaForm[field] || 0}
                          onChange={val => setEditSemanaForm(prev => ({ ...prev, [field]: val }))}
                          style={{ width: '80px', textAlign: 'right', padding: '0.2rem 0.3rem', fontSize: '0.72rem', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-input, #fff)' }}
                          className=""
                        />
                      </td>
                    ))}
                    <td style={{ padding: '0.25rem 0.3rem', textAlign: 'right' }}>
                      <input type="number" min={0} style={{ width: '50px', textAlign: 'right', padding: '0.2rem 0.3rem', fontSize: '0.72rem', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-input, #fff)' }}
                        value={editSemanaForm.propostas_pagas || ''}
                        onChange={ev => setEditSemanaForm(prev => ({ ...prev, propostas_pagas: parseInt(ev.target.value) || 0 }))} />
                    </td>
                    <td style={{ padding: '0.25rem 0.3rem', textAlign: 'right', fontSize: '0.72rem', fontWeight: 650, color: 'var(--primary-color)' }}>
                      {formatCurrency((editSemanaForm.vol_fgts||0)+(editSemanaForm.vol_clt||0)+(editSemanaForm.vol_cgv||0)+(editSemanaForm.vol_pix||0))}
                    </td>
                    <td style={{ padding: '0.25rem 0.3rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end' }}>
                        <button title="Salvar" onClick={() => saveEditSemana(s)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--success)', padding: '0.2rem' }}><Save size={13} /></button>
                        <button title="Cancelar" onClick={cancelEditSemana} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}><X size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={s.id}>
                  <td style={{ padding: '0.45rem 0.4rem', fontSize: '0.72rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{periodo}</td>
                  <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontSize: '0.72rem' }}>{formatCurrency(s.vol_fgts)}</td>
                  <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontSize: '0.72rem' }}>{formatCurrency(s.vol_clt)}</td>
                  <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontSize: '0.72rem' }}>{formatCurrency(s.vol_cgv)}</td>
                  <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontSize: '0.72rem' }}>{formatCurrency(s.vol_pix)}</td>
                  <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontSize: '0.72rem' }}>{s.propostas_pagas ?? 0}</td>
                  <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontSize: '0.72rem', fontWeight: 650, color: 'var(--primary-color)' }}>
                    {formatCurrency((s.vol_fgts||0)+(s.vol_clt||0)+(s.vol_cgv||0)+(s.vol_pix||0))}
                  </td>
                  <td style={{ padding: '0.25rem 0.3rem', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '0.2rem', justifyContent: 'flex-end' }}>
                      <button title="Editar" onClick={() => startEditSemana(s)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}><Edit size={12} /></button>
                      <button title="Excluir" onClick={() => deleteSemana(s)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '0.2rem' }}><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              );
            };

            if (producao.length === 0 && semanas.length === 0) {
              return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1.5rem 0', textAlign: 'center' }}>Nenhum volume registrado.</p>;
            }

            // Unificar meses com registro mensal e meses só com semanas em lista
            // única, ordenada de forma decrescente (mês mais recente no topo).
            type MesUnificado =
              | { tipo: 'mensal'; key: string; prod: (typeof mesesOrdenados)[number] }
              | { tipo: 'semanas'; key: string; ano: number; mes: number };

            const todosMeses: MesUnificado[] = [
              ...mesesOrdenados.map(prod => ({
                tipo: 'mensal' as const,
                key: `${prod.ano}-${prod.mes}`,
                prod
              })),
              ...mesesSoComSemanas.map(key => {
                const [ano, mes] = key.split('-').map(Number);
                return { tipo: 'semanas' as const, key, ano, mes };
              })
            ].sort((a, b) => {
              const [aA, aM] = a.key.split('-').map(Number);
              const [bA, bM] = b.key.split('-').map(Number);
              return bA !== aA ? bA - aA : bM - aM;
            });

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {todosMeses.map(item => {
                  if (item.tipo === 'mensal') {
                    const { key, prod } = item;
                    const isLegacy = !mesesComSemanas.has(key);
                    const semanasDoMes = semanasPorMes[key] || [];
                    const expanded = expandedMonths.has(key);
                    const mesLabel = `${NOMES_MES[prod.mes - 1]}/${prod.ano}`;
                    const isEditingLeg = editingLegadoId === prod.id;

                    return (
                      <div key={key} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                        <div
                          onClick={() => toggleMonth(key)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.03)', cursor: 'pointer', borderBottom: expanded ? '1px solid var(--border-color)' : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {expanded ? <ChevronDown size={14} /> : <ChevronRightIcon size={14} />}
                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--secondary-color)' }}>{mesLabel}</span>
                            {isLegacy && <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', backgroundColor: 'rgba(100,116,139,0.15)', color: 'var(--text-muted)', borderRadius: '3px', fontWeight: 600 }}>LEGADO</span>}
                            {!isLegacy && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{semanasDoMes.length} semana(s)</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--primary-color)' }}>{formatCurrency(prod.vol_total || 0)}</span>
                            <div style={{ display: 'flex', gap: '0.2rem' }}>
                              {isLegacy && (
                                <button title="Editar total mensal" onClick={e => { e.stopPropagation(); startEditLegado(prod); }}
                                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}><Edit size={13} /></button>
                              )}
                              <button title="Excluir" onClick={e => { e.stopPropagation(); if (isLegacy) deleteLegado(prod); }}
                                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '0.2rem' }}><Trash2 size={13} /></button>
                            </div>
                          </div>
                        </div>

                        {isLegacy && isEditingLeg && (
                          <div style={{ padding: '0.75rem', backgroundColor: 'rgba(15,184,130,0.05)', borderTop: '1px solid var(--border-color)' }}>
                            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontStyle: 'italic' }}>
                              Editando totais mensais do registro legado de {mesLabel}
                            </p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '0.5rem', marginBottom: '0.6rem' }}>
                              {(['vol_fgts','vol_clt','vol_cgv','vol_pix'] as const).map(field => (
                                <div key={field}>
                                  <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{field.replace('vol_','').toUpperCase()}</label>
                                  <CurrencyInput
                                    value={editLegadoForm[field] || 0}
                                    onChange={val => setEditLegadoForm(prev => ({ ...prev, [field]: val }))}
                                    style={{ padding: '0.3rem 0.4rem', fontSize: '0.78rem', marginTop: '0.15rem', width: '100%', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-input, #fff)' }}
                                    className=""
                                  />
                                </div>
                              ))}
                              <div>
                                <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>PROPOSTAS</label>
                                <input type="number" min={0} className="form-input" style={{ padding: '0.3rem 0.4rem', fontSize: '0.78rem', marginTop: '0.15rem' }}
                                  value={editLegadoForm.propostas_pagas || ''}
                                  onChange={ev => setEditLegadoForm(prev => ({ ...prev, propostas_pagas: parseInt(ev.target.value) || 0 }))} />
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                              <button className="btn btn-secondary" style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem' }} onClick={cancelEditLegado}>Cancelar</button>
                              <button className="btn btn-primary" style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem' }} onClick={() => saveLegado(prod)}>Salvar</button>
                            </div>
                          </div>
                        )}

                        {isLegacy && expanded && !isEditingLeg && (
                          <div className="table-container" style={{ border: 'none', boxShadow: 'none', margin: 0 }}>
                            <table className="table" style={{ fontSize: '0.72rem', width: '100%' }}>
                              <thead>
                                <tr>
                                  <th style={thStyle}>Período</th>
                                  <th style={{ ...thStyle, textAlign: 'right' }}>FGTS</th>
                                  <th style={{ ...thStyle, textAlign: 'right' }}>CLT</th>
                                  <th style={{ ...thStyle, textAlign: 'right' }}>CGV</th>
                                  <th style={{ ...thStyle, textAlign: 'right' }}>PIX</th>
                                  <th style={{ ...thStyle, textAlign: 'right' }}>Propos.</th>
                                  <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td style={{ padding: '0.45rem 0.4rem', fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{mesLabel} (consolidado)</td>
                                  <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontSize: '0.72rem' }}>{formatCurrency(prod.vol_fgts || 0)}</td>
                                  <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontSize: '0.72rem' }}>{formatCurrency(prod.vol_clt || 0)}</td>
                                  <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontSize: '0.72rem' }}>{formatCurrency(prod.vol_cgv || 0)}</td>
                                  <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontSize: '0.72rem' }}>{formatCurrency(prod.vol_pix || 0)}</td>
                                  <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontSize: '0.72rem' }}>{prod.propostas_pagas ?? 0}</td>
                                  <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right', fontSize: '0.72rem', fontWeight: 650, color: 'var(--primary-color)' }}>{formatCurrency(prod.vol_total || 0)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}

                        {!isLegacy && expanded && (
                          <div className="table-container" style={{ border: 'none', boxShadow: 'none', margin: 0 }}>
                            <table className="table" style={{ fontSize: '0.72rem', width: '100%' }}>
                              <thead>
                                <tr>
                                  <th style={thStyle}>Período</th>
                                  <th style={{ ...thStyle, textAlign: 'right' }}>FGTS</th>
                                  <th style={{ ...thStyle, textAlign: 'right' }}>CLT</th>
                                  <th style={{ ...thStyle, textAlign: 'right' }}>CGV</th>
                                  <th style={{ ...thStyle, textAlign: 'right' }}>PIX</th>
                                  <th style={{ ...thStyle, textAlign: 'right' }}>Propos.</th>
                                  <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                                  <th style={{ ...thStyle, width: '60px' }}></th>
                                </tr>
                              </thead>
                              <tbody>
                                {semanasDoMes.map(s => renderSemanaRow(s))}
                                <tr style={{ backgroundColor: 'rgba(15,184,130,0.07)', fontWeight: 700 }}>
                                  <td colSpan={6} style={{ padding: '0.4rem', fontSize: '0.72rem', textAlign: 'right', color: 'var(--text-muted)' }}>Subtotal {mesLabel}</td>
                                  <td style={{ padding: '0.4rem', textAlign: 'right', fontSize: '0.78rem', color: 'var(--primary-color)' }}>{formatCurrency(prod.vol_total || 0)}</td>
                                  <td></td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  }

                  // tipo === 'semanas': mês sem registro mensal consolidado (ex: mês atual em andamento)
                  const { key, ano, mes } = item;
                  const semanasDoMes = semanasPorMes[key] || [];
                  const mesLabel = `${NOMES_MES[mes - 1]}/${ano}`;
                  const totalMes = semanasDoMes.reduce((s, w) => s + ((w.vol_fgts||0)+(w.vol_clt||0)+(w.vol_cgv||0)+(w.vol_pix||0)), 0);
                  const expanded = expandedMonths.has(key);
                  return (
                    <div key={key} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                      <div onClick={() => toggleMonth(key)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.03)', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {expanded ? <ChevronDown size={14} /> : <ChevronRightIcon size={14} />}
                          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--secondary-color)' }}>{mesLabel}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{semanasDoMes.length} semana(s)</span>
                        </div>
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--primary-color)' }}>{formatCurrency(totalMes)}</span>
                      </div>
                      {expanded && (
                        <div className="table-container" style={{ border: 'none', boxShadow: 'none', margin: 0 }}>
                          <table className="table" style={{ fontSize: '0.72rem' }}>
                            <thead><tr>
                              <th style={thStyle}>Período</th>
                              <th style={{ ...thStyle, textAlign: 'right' }}>FGTS</th>
                              <th style={{ ...thStyle, textAlign: 'right' }}>CLT</th>
                              <th style={{ ...thStyle, textAlign: 'right' }}>CGV</th>
                              <th style={{ ...thStyle, textAlign: 'right' }}>PIX</th>
                              <th style={{ ...thStyle, textAlign: 'right' }}>Propos.</th>
                              <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                              <th style={{ ...thStyle, width: '60px' }}></th>
                            </tr></thead>
                            <tbody>{semanasDoMes.map(s => renderSemanaRow(s))}</tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

      </div>

      {/* Histórico de Interações Comerciais */}
      <div style={{ marginBottom: '2rem' }}>
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 className="card-title">
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <History size={20} /> Histórico de Interações Comerciais
            </span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', maxHeight: '420px', overflowY: 'auto', paddingRight: '0.25rem' }}>
            {logs.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem 0' }}>
                Nenhum contato registrado ainda para este parceiro.
              </p>
            ) : (
              logs.map(log => (
                <div key={log.id} style={{ padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', backgroundColor: '#ffffff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem', borderBottom: '1px dashed var(--border-color)', paddingBottom: '0.5rem', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="badge badge-info">{log.canal}</span>
                      <span className="badge badge-success" style={{ backgroundColor: '#f1f5f9', color: 'var(--text-main)' }}>{log.processo}</span>
                      <span style={{ fontWeight: 650, color: 'var(--secondary-color)' }}>{new Date(log.data_contato).toLocaleDateString('pt-BR')}</span>
                    </div>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.4, fontWeight: 550 }}>{log.resumo}</p>
                  {log.proxima_acao && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Próxima ação: <strong>{log.proxima_acao}</strong> em <strong>{new Date(log.data_proxima_acao + 'T12:00:00').toLocaleDateString('pt-BR')}</strong>
                    </div>
                  )}
                  {log.diagnostico_dor && (
                    <div style={{ marginTop: '0.5rem', padding: '0.5rem', borderRadius: '4px', backgroundColor: '#f8fafc', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', borderLeft: '2px solid var(--primary-color)' }}>
                      <div><strong>Motivo/Causa:</strong> {log.diagnostico_causa}</div>
                      <div><strong>Dor Relatada:</strong> {log.diagnostico_dor}</div>
                      {log.diagnostico_concorrentes && <div><strong>Concorrentes Citados:</strong> {log.diagnostico_concorrentes}</div>}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Modal de Produção Semanal */}
      {showSemanalForm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(7,12,20,0.7)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 100, padding: '3rem 1.5rem', overflowY: 'auto', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
          <div className="card fade-in" style={{ width: '100%', maxWidth: '580px', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', backgroundColor: 'rgba(209,250,237,0.95)', border: '1px solid rgba(15,184,130,0.35)', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--secondary-color)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CalendarDays size={18} /> Registrar Produção Semanal
              </h3>
              <button onClick={() => setShowSemanalForm(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>

            {semanalUpsertWarning && (
              <div style={{ padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', fontSize: '0.8rem', color: 'var(--warning)', marginBottom: '1rem' }}>
                ⚠️ Já existia um registro manual para esta semana. Os valores anteriores foram substituídos.
              </div>
            )}

            <form onSubmit={handleSemanalSubmit}>
              <div style={{ marginBottom: '1.25rem' }}>
                <WeekSelector value={semanalWeek} onChange={setSemanalWeek} label="Semana de referência" />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">FGTS (R$)</label>
                  <CurrencyInput value={semanalForm.vol_fgts} onChange={val => setSemanalForm(p => ({ ...p, vol_fgts: val }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">CLT Consignado (R$)</label>
                  <CurrencyInput value={semanalForm.vol_clt} onChange={val => setSemanalForm(p => ({ ...p, vol_clt: val }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">CGV (R$)</label>
                  <CurrencyInput value={semanalForm.vol_cgv} onChange={val => setSemanalForm(p => ({ ...p, vol_cgv: val }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Pix no Cartão (R$)</label>
                  <CurrencyInput value={semanalForm.vol_pix} onChange={val => setSemanalForm(p => ({ ...p, vol_pix: val }))} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Propostas Pagas</label>
                <input type="number" min={0} className="form-input" value={semanalForm.propostas_pagas || ''} onChange={e => setSemanalForm(p => ({ ...p, propostas_pagas: parseInt(e.target.value) || 0 }))} />
              </div>

              <div style={{ padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(15,184,130,0.1)', marginTop: '0.75rem', fontSize: '0.85rem', fontWeight: 700, color: 'var(--secondary-color)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Total desta semana:</span>
                <span style={{ color: 'var(--primary-color)' }}>{formatCurrency((semanalForm.vol_fgts||0)+(semanalForm.vol_clt||0)+(semanalForm.vol_cgv||0)+(semanalForm.vol_pix||0))}</span>
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowSemanalForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Save size={14} /> Registrar Semana
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <PartnerFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        partner={partner}
        onSave={loadData}
      />
    </div>
  );
}
