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
  History
} from 'lucide-react';
import PartnerFormModal from './PartnerFormModal';

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
  const [loading, setLoading] = useState(true);

  // Form de Lançamento de Produção
  const [showProdForm, setShowProdForm] = useState(false);
  const [prodForm, setProdForm] = useState({
    ano: 2026,
    mes: 6,
    vol_fgts: 0,
    vol_clt: 0,
    vol_cgv: 0,
    vol_pix: 0
  });

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
        const logData = await dataService.getLogs(partnerId);
        setLogs(logData);

        // Produção Semanal
        const semanasData = await dataService.getProducoesSemanais(partnerId);
        setSemanas(semanasData);

        // Participação na carteira total do Prata
        const totalPrataGlobal = partnersList.reduce((sum, p) => sum + (p.vol_prata_mensal || 0), 0) || 1;
        setSharePortfolio(((current.vol_prata_mensal || 0) / totalPrataGlobal) * 100);
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
  const notes = calculateCriteriaNotes(partner);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(val);
  };

  const handleProdSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await dataService.saveProducao({
        parceiro_id: partner.id,
        ...prodForm
      });
      setShowProdForm(false);
      await loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const openEditModal = () => {
    setIsFormOpen(true);
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
                partner.status === 'Reativação' ? 'badge-danger' : 'badge-info'
              }`} style={{ fontSize: '0.7rem' }}>
                {partner.status}
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              CNPJ: {partner.cnpj} · Atuação: {partner.modelo_atuacao} ({partner.area_geografica})
            </p>
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
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>VOL. PRATA ATUAL</span>
            <p style={{ fontWeight: 700, color: 'var(--primary-color)', fontSize: '1.1rem', marginTop: '0.15rem' }}>{formatCurrency(partner.vol_prata_mensal)}</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>de {formatCurrency(partner.vol_total_mensal)}</p>
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
              {partner.vol_total_mensal > 0 ? `${((partner.vol_prata_mensal / partner.vol_total_mensal) * 100).toFixed(0)}%` : 'NVT'}
            </p>
            {partner.vol_total_mensal > 0 ? (
              <span className={`badge ${(partner.vol_prata_mensal / partner.vol_total_mensal) >= 0.3 ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', marginTop: '0.1rem' }}>
                {(partner.vol_prata_mensal / partner.vol_total_mensal) >= 0.3 ? 'Verde' : 'Abaixo Meta (30%)'}
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
              {partner.produtos_ativos.map(p => (
                <span key={p} className="badge badge-info" style={{ fontSize: '0.65rem', padding: '0.15rem 0.45rem' }}>{p}</span>
              ))}
              {partner.produtos_ativos.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nenhum ativo</span>}
            </div>
          </div>
        </div>
      </div>

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
              { label: 'Volume total mensal (25%)', note: notes.n1, desc: 'Declarado' },
              { label: 'Concentração atual no Prata (20%)', note: notes.n2, desc: partner.vol_total_mensal > 0 ? `${((partner.vol_prata_mensal / partner.vol_total_mensal) * 100).toFixed(0)}%` : 'NVT' },
              { label: 'Estrutura / Nº Vendedores (15%)', note: notes.n3, desc: `${partner.num_vendedores} vend.` },
              { label: 'Abrangência geográfica (15%)', note: notes.n4, desc: partner.area_geografica },
              { label: 'Produtos ativos no Prata (10%)', note: notes.n5, desc: `${partner.produtos_ativos.length} prod.` },
              { label: 'Modelo de atuação (10%)', note: notes.n6, desc: partner.modelo_atuacao },
              { label: 'Risco de dependência de produto único (5%)', note: notes.n7, desc: `${partner.produtos_ativos.length} prod.` }
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

        {/* Bloco de Produção Mensal */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 className="card-title" style={{ justifyContent: 'space-between', fontSize: '1rem', marginBottom: '0.75rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={18} /> Histórico de Produção Mensal
            </span>
            <button className="btn btn-secondary" style={{ padding: '0.35rem 0.65rem', fontSize: '0.725rem' }} onClick={() => setShowProdForm(true)}>
              <Plus size={12} /> Registrar Produção
            </button>
          </h3>

          <div className="table-container" style={{ border: 'none', boxShadow: 'none', overflowX: 'visible' }}>
            <table className="table" style={{ fontSize: '0.75rem', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', padding: '0.5rem 0.4rem' }}>Mês/Ano</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right', padding: '0.5rem 0.4rem' }}>FGTS</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right', padding: '0.5rem 0.4rem' }}>CLT</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right', padding: '0.5rem 0.4rem' }}>CGV</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right', padding: '0.5rem 0.4rem' }}>Pix</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right', padding: '0.5rem 0.4rem' }}>Total Prata</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right', padding: '0.5rem 0.4rem' }}>Conc. %</th>
                </tr>
              </thead>
              <tbody>
                {producao.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>Nenhum volume registrado.</td>
                  </tr>
                ) : (
                  producao.map(p => {
                    const totalDeclarado = partner.vol_total_mensal;
                    const concText = totalDeclarado > 0 ? `${Math.min(100, (p.vol_total! / totalDeclarado) * 100).toFixed(0)}%` : 'NVT';
                    return (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 650, whiteSpace: 'nowrap', padding: '0.5rem 0.4rem' }}>{p.mes.toString().padStart(2, '0')}/{p.ano}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0.5rem 0.4rem' }}>{formatCurrency(p.vol_fgts)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0.5rem 0.4rem' }}>{formatCurrency(p.vol_clt)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0.5rem 0.4rem' }}>{formatCurrency(p.vol_cgv)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: '0.5rem 0.4rem' }}>{formatCurrency(p.vol_pix)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 650, color: 'var(--primary-color)', whiteSpace: 'nowrap', padding: '0.5rem 0.4rem' }}>{formatCurrency(p.vol_total!)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, padding: '0.5rem 0.4rem' }}>{concText}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Grid de Duas Colunas: Produção Semanal / Logs de Relacionamento */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '1.5rem', marginBottom: '2rem', alignItems: 'start' }}>
        
        {/* Bloco de Produção Semanal */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h3 className="card-title">
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CalendarDays size={20} /> Detalhamento de Faturamento Semanal (Mês Corrente)
            </span>
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem', marginTop: '0.2rem' }}>
            Lançamentos acumulados da planilha de faturamento semanal para Junho/2026.
          </p>

          <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)' }}>Semana</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right' }}>FGTS</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right' }}>CLT</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right' }}>CGV / Pix</th>
                  <th style={{ backgroundColor: 'var(--secondary-color)', color: '#ffffff', borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const semanasMêsAtivo = semanas.filter(s => s.ano === 2026 && s.mes === 6);
                  if (semanasMêsAtivo.length === 0) {
                    return (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>
                          Nenhum faturamento semanal carregado para Junho/2026.
                        </td>
                      </tr>
                    );
                  }
                  return semanasMêsAtivo.map(s => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 650 }}>Semana {s.semana}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(s.vol_fgts)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(s.vol_clt)}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(s.vol_cgv + s.vol_pix)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 650, color: 'var(--primary-color)' }}>
                        {formatCurrency((s.vol_fgts || 0) + (s.vol_clt || 0) + (s.vol_cgv || 0) + (s.vol_pix || 0))}
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>

        {/* Histórico de Logs / Reuniões */}
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
                <div key={log.id} style={{
                  padding: '1rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  backgroundColor: '#ffffff'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem', borderBottom: '1px dashed var(--border-color)', paddingBottom: '0.5rem', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="badge badge-info">{log.canal}</span>
                      <span className="badge badge-success" style={{ backgroundColor: '#f1f5f9', color: 'var(--text-main)' }}>{log.processo}</span>
                      <span style={{ fontWeight: 650, color: 'var(--secondary-color)' }}>
                        {new Date(log.data_contato).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  </div>

                  <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.4, fontWeight: 550 }}>
                    {log.resumo}
                  </p>

                  {log.proxima_acao && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Próxima ação: <strong>{log.proxima_acao}</strong> em <strong>{new Date(log.data_proxima_acao + 'T12:00:00').toLocaleDateString('pt-BR')}</strong>
                    </div>
                  )}

                  {/* Se houver bloco de diagnóstico (reunião completa) */}
                  {log.diagnostico_dor && (
                    <div style={{
                      marginTop: '0.5rem',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      backgroundColor: '#f8fafc',
                      fontSize: '0.75rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                      borderLeft: '2px solid var(--primary-color)'
                    }}>
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

      {/* Modal de Lançamento de Produção */}
      {showProdForm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(7, 12, 20, 0.7)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          zIndex: 100,
          padding: '3rem 1.5rem',
          overflowY: 'auto',
          backdropFilter: 'var(--glass-blur)',
          WebkitBackdropFilter: 'var(--glass-blur)'
        }}>
          <div className="card fade-in" style={{
            width: '100%',
            maxWidth: '650px',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            backgroundColor: 'rgba(209, 250, 237, 0.95)',
            border: '1px solid rgba(15, 184, 130, 0.35)',
            marginBottom: '2rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--secondary-color)' }}>Registrar Produção Mensal</h3>
              <button onClick={() => setShowProdForm(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>

            <form onSubmit={handleProdSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Mês *</label>
                  <select className="form-input" value={prodForm.mes} onChange={(e) => setProdForm(prev => ({ ...prev, mes: parseInt(e.target.value) }))}>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i+1} value={i+1}>{new Date(2026, i, 1).toLocaleDateString('pt-BR', { month: 'long' })}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Ano *</label>
                  <select className="form-input" value={prodForm.ano} onChange={(e) => setProdForm(prev => ({ ...prev, ano: parseInt(e.target.value) }))}>
                    <option value={2026}>2026</option>
                    <option value={2025}>2025</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">FGTS (R$)</label>
                  <input type="number" min={0} className="form-input" value={prodForm.vol_fgts} onChange={(e) => setProdForm(prev => ({ ...prev, vol_fgts: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">CLT Consignado (R$)</label>
                  <input type="number" min={0} className="form-input" value={prodForm.vol_clt} onChange={(e) => setProdForm(prev => ({ ...prev, vol_clt: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">CGV (R$)</label>
                  <input type="number" min={0} className="form-input" value={prodForm.vol_cgv} onChange={(e) => setProdForm(prev => ({ ...prev, vol_cgv: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Pix no Cartão (R$)</label>
                  <input type="number" min={0} className="form-input" value={prodForm.vol_pix} onChange={(e) => setProdForm(prev => ({ ...prev, vol_pix: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '2rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowProdForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Registrar Produção</button>
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
