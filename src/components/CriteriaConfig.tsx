import React, { useEffect, useState } from 'react';
import { dataService } from '../services/dataService';
import { CriteriosConfig } from '../types';
import { Sliders, Target, CalendarDays, CheckCircle2, RotateCcw } from 'lucide-react';

export default function CriteriaConfig() {
  const [config, setConfig] = useState<CriteriosConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadConfig() {
      try {
        setLoading(true);
        const data = await dataService.getCriterios();
        setConfig(data);
      } catch (e) {
        console.error('Erro ao ler configurações de critérios:', e);
        setErrorMsg('Não foi possível carregar as configurações.');
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, []);

  const handleInputChange = (section: keyof CriteriosConfig, key: string, value: number) => {
    if (!config) return;
    setConfig((prev: any) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }));
  };

  // Handler para atualizar uma posição específica dentro de um array de faixas
  const handleFaixaChange = (
    arrayKey: 'vol_total_faixas' | 'concentracao_faixas' | 'vendedores_faixas',
    idx: number,
    value: number
  ) => {
    if (!config) return;
    setConfig((prev: any) => {
      const faixas = [...prev.score_notas[arrayKey]] as [number, number, number, number];
      faixas[idx] = value;
      return {
        ...prev,
        score_notas: {
          ...prev.score_notas,
          [arrayKey]: faixas
        }
      };
    });
  };

  const calculatePesosSum = () => {
    if (!config) return 0;
    const p = config.pesos_score;
    return p.vol_total + p.concentracao + p.num_vendedores + p.area_geografica + p.produtos_ativos + p.modelo_atuacao + p.diversificacao;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    
    setErrorMsg(null);
    setSuccessMsg(null);

    const sum = calculatePesosSum();
    if (sum !== 100) {
      setErrorMsg(`A soma dos pesos do Score Comercial deve ser exatamente 100%. Soma atual: ${sum}%.`);
      return;
    }

    if (
      config.score_thresholds &&
      config.score_thresholds.crescimento >= config.score_thresholds.estrategico
    ) {
      setErrorMsg('O limiar de Crescimento deve ser menor que o limiar de Estratégico.');
      return;
    }

    try {
      setSaving(true);
      await dataService.saveCriterios(config);
      setSuccessMsg('Configurações de critérios comerciais salvas com sucesso!');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e) {
      setErrorMsg('Falha ao salvar as configurações no banco de dados.');
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefault = async () => {
    if (window.confirm('Deseja realmente restaurar os critérios padrão de fábrica?')) {
      const defaultCriterios: CriteriosConfig = {
        metas: {
          hunter_novos_ativos_semana: 2,
          hunter_reativacoes_semana: 1,
          farmer_propostas_pagas_semana: 1200,
          farmer_concentracao_minima: 30,
          meta_taxa_ativos: 70,
          meta_churn: 10,
          meta_media_produtos: 2,
          meta_taxa_reativacao: 25
        },
        score_thresholds: {
          estrategico: 70,
          crescimento: 40
        },
        score_notas: {
          vol_total_faixas: [30000, 80000, 150000, 300000],
          concentracao_faixas: [10, 20, 30, 50],
          vendedores_faixas: [1, 3, 5, 10]
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
      try {
        setSaving(true);
        await dataService.saveCriterios(defaultCriterios);
        setConfig(defaultCriterios);
        setSuccessMsg('Critérios padrão restaurados!');
        setTimeout(() => setSuccessMsg(null), 3000);
      } catch (e) {
        setErrorMsg('Erro ao restaurar critérios.');
      } finally {
        setSaving(false);
      }
    }
  };

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', fontSize: '1.1rem', fontWeight: 550 }}>Carregando critérios de classificação comercial...</div>;
  }

  if (!config) {
    return <div className="card">Erro ao carregar critérios.</div>;
  }

  const pesosSum = calculatePesosSum();

  return (
    <div className="fade-in" style={{ maxWidth: '1000px', margin: '0 auto' }}>
      
      {/* Cabeçalho */}
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--secondary-color)' }}>
            Configuração de Critérios & Metas
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
            Ajuste as réguas operacionais, prazos do fluxo de status e pesos do score do CRM.
          </p>
        </div>
        <button 
          type="button" 
          onClick={handleRestoreDefault}
          className="btn btn-secondary"
          style={{ fontSize: '0.8rem', padding: '0.5rem 1rem' }}
        >
          <RotateCcw size={14} /> Restaurar Padrões
        </button>
      </div>

      {/* Alertas */}
      {successMsg && (
        <div style={{
          padding: '1rem',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--success-bg)',
          color: 'var(--success)',
          fontWeight: 600,
          marginBottom: '1.5rem',
          border: '1px solid #a7f3d0',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <CheckCircle2 size={18} /> {successMsg}
        </div>
      )}

      {errorMsg && (
        <div style={{
          padding: '1rem',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: 'var(--danger-bg)',
          color: 'var(--danger)',
          fontWeight: 600,
          marginBottom: '1.5rem',
          border: '1px solid #fecaca'
        }}>
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSave}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Seção 1: Metas do Semáforo Comercial */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 className="card-title">
              <Target size={20} /> Metas Semanais (Semáforo de Desempenho)
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Define os limites mínimos de atividades e volumes para colorir os semáforos de Hunter e Farmer.
            </p>
            
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1.25rem'
            }}>
              <div className="form-group">
                <label className="form-label">Farmer: Propostas Pagas por Semana</label>
                <input 
                  type="number" 
                  min={1} 
                  required
                  className="form-input" 
                  value={config.metas.farmer_propostas_pagas_semana}
                  onChange={(e) => handleInputChange('metas', 'farmer_propostas_pagas_semana', parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Farmer: Concentração Mínima (%)</label>
                <input 
                  type="number" 
                  min={1} 
                  max={100}
                  required
                  className="form-input" 
                  value={config.metas.farmer_concentracao_minima}
                  onChange={(e) => handleInputChange('metas', 'farmer_concentracao_minima', parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Hunter: Novos Ativos por Semana</label>
                <input 
                  type="number" 
                  min={1} 
                  required
                  className="form-input" 
                  value={config.metas.hunter_novos_ativos_semana}
                  onChange={(e) => handleInputChange('metas', 'hunter_novos_ativos_semana', parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Winback: Reativações por Semana</label>
                <input 
                  type="number" 
                  min={1} 
                  required
                  className="form-input" 
                  value={config.metas.hunter_reativacoes_semana}
                  onChange={(e) => handleInputChange('metas', 'hunter_reativacoes_semana', parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>

          {/* Seção 1b: Metas dos KPIs da Carteira */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 className="card-title">
              <Target size={20} /> Metas dos KPIs da Carteira
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Define os benchmarks exibidos nos cards de desempenho do Dashboard, determinando se cada indicador está dentro ou fora da meta.
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1.25rem'
            }}>
              <div className="form-group">
                <label className="form-label">Taxa de Parceiros Ativos — Meta Mínima (%)</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  required
                  className="form-input"
                  value={config.metas.meta_taxa_ativos}
                  onChange={(e) => handleInputChange('metas', 'meta_taxa_ativos', parseFloat(e.target.value) || 0)}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Percentual mínimo de parceiros Ativos sobre o total da carteira.
                </span>
              </div>
              <div className="form-group">
                <label className="form-label">Churn da Carteira — Meta Máxima (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  required
                  className="form-input"
                  value={config.metas.meta_churn}
                  onChange={(e) => handleInputChange('metas', 'meta_churn', parseFloat(e.target.value) || 0)}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Percentual máximo tolerado de parceiros que passaram para Inativo no período.
                </span>
              </div>
              <div className="form-group">
                <label className="form-label">Média de Produtos — Meta Mínima</label>
                <input
                  type="number"
                  min={1}
                  step={0.1}
                  required
                  className="form-input"
                  value={config.metas.meta_media_produtos}
                  onChange={(e) => handleInputChange('metas', 'meta_media_produtos', parseFloat(e.target.value) || 0)}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Número médio mínimo de produtos ativos por parceiro Ativo no período.
                </span>
              </div>
              <div className="form-group">
                <label className="form-label">Taxa de Reativação — Meta Mínima (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  required
                  className="form-input"
                  value={config.metas.meta_taxa_reativacao}
                  onChange={(e) => handleInputChange('metas', 'meta_taxa_reativacao', parseFloat(e.target.value) || 0)}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Percentual mínimo de parceiros Inativos que devem ser reativados no período.
                </span>
              </div>
            </div>
          </div>

          {/* Seção 2: Prazos e Limites de Status */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 className="card-title">
              <CalendarDays size={20} /> Prazos do Ciclo de Vida do Parceiro (Frequências)
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Gerencia os intervalos de dias usados para mover automaticamente os parceiros entre os status.
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1.25rem'
            }}>
              <div className="form-group">
                <label className="form-label">Inatividade Win-back (Dias sem Produção)</label>
                <input 
                  type="number" 
                  min={1} 
                  required
                  className="form-input" 
                  value={config.limites.dias_inatividade_winback}
                  onChange={(e) => handleInputChange('limites', 'dias_inatividade_winback', parseInt(e.target.value) || 0)}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Dias com produção zerada que alteram o status de Ativo para "Inativo" automaticamente.
                </span>
              </div>
              <div className="form-group">
                <label className="form-label">Conversão Hunter (Limite em Dias)</label>
                <input 
                  type="number" 
                  min={1} 
                  required
                  className="form-input" 
                  value={config.limites.dias_conversao_hunter}
                  onChange={(e) => handleInputChange('limites', 'dias_conversao_hunter', parseInt(e.target.value) || 0)}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Dias tolerados para um novo parceiro cadastrado registrar a primeira produção antes de virar "Inativo".
                </span>
              </div>
            </div>
          </div>

          {/* Seção 3: Pesos do Score Comercial */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 className="card-title" style={{ justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sliders size={20} /> Pesos do Score Comercial (Total: 100%)
              </span>
              <span className={`badge ${pesosSum === 100 ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.85rem' }}>
                Soma atual: {pesosSum}%
              </span>
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              Defina o peso e impacto de cada critério na nota de 0 a 100 do parceiro. A soma dos pesos deve totalizar exatamente 100%.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {[
                { label: 'Volume total mensal (Mercado)', key: 'vol_total' },
                { label: 'Concentração atual no Prata', key: 'concentracao' },
                { label: 'Estrutura (Nº vendedores)', key: 'num_vendedores' },
                { label: 'Abrangência geográfica', key: 'area_geografica' },
                { label: 'Produtos ativos no Prata', key: 'produtos_ativos' },
                { label: 'Modelo de atuação', key: 'modelo_atuacao' },
                { label: 'Diversificação (Risco de produto único)', key: 'diversificacao' }
              ].map(item => (
                <div key={item.key} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1.5rem',
                  fontSize: '0.9rem',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid #f1f5f9',
                  paddingBottom: '0.75rem'
                }}>
                  <span style={{ fontWeight: 550, color: 'var(--secondary-color)', width: '300px' }}>{item.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, justifySelf: 'end', maxWidth: '400px' }}>
                    <input 
                      type="range" 
                      min={0} 
                      max={50} 
                      step={5}
                      style={{ flex: 1, accentColor: 'var(--primary-color)' }}
                      value={(config.pesos_score as any)[item.key]} 
                      onChange={(e) => handleInputChange('pesos_score', item.key, parseInt(e.target.value) || 0)}
                    />
                    <input 
                      type="number" 
                      min={0} 
                      max={100}
                      className="form-input" 
                      style={{ width: '80px', padding: '0.35rem 0.5rem', textAlign: 'center' }}
                      value={(config.pesos_score as any)[item.key]} 
                      onChange={(e) => handleInputChange('pesos_score', item.key, parseInt(e.target.value) || 0)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Seção 4: Limiares de Classificação do Score */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 className="card-title">
              <Target size={20} /> Limiares de Classificação do Score
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Define os valores mínimos de score (0–100) para que um parceiro seja classificado como Estratégico ou Crescimento.
              Parceiros abaixo do limiar de Crescimento são classificados automaticamente como Desenvolvimento.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label" style={{ color: 'var(--success)', fontWeight: 700 }}>
                  Estratégico — Score Mínimo
                </label>
                <input
                  type="number" min={1} max={100} required className="form-input"
                  value={config.score_thresholds?.estrategico ?? 70}
                  onChange={(e) => handleInputChange('score_thresholds', 'estrategico', parseInt(e.target.value) || 0)}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Score ≥ este valor → parceiro é Estratégico.
                </span>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: '#3b82f6', fontWeight: 700 }}>
                  Crescimento — Score Mínimo
                </label>
                <input
                  type="number" min={1} max={100} required className="form-input"
                  value={config.score_thresholds?.crescimento ?? 40}
                  onChange={(e) => handleInputChange('score_thresholds', 'crescimento', parseInt(e.target.value) || 0)}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Score ≥ este valor (e abaixo de Estratégico) → parceiro é Crescimento.
                </span>
              </div>
            </div>
            {config.score_thresholds && config.score_thresholds.crescimento >= config.score_thresholds.estrategico && (
              <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--danger)', fontWeight: 600 }}>
                ⚠️ O limiar de Crescimento deve ser menor que o de Estratégico.
              </p>
            )}
          </div>

          {/* Seção 5: Faixas de Pontuação dos Critérios Numéricos */}
          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 className="card-title">
              <Sliders size={20} /> Faixas de Pontuação dos Critérios Numéricos
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              Define os valores-limite que determinam a nota (1 → 3 → 5 → 7 → 9) para cada critério numérico.
              Valores ≤ Faixa 1 recebem nota 1; entre Faixa 1 e 2 recebem nota 3; e assim por diante.
              Acima de Faixa 4 sempre recebem nota 9.
            </p>

            {/* N1: Volume Total Mensal */}
            <div style={{ marginBottom: '1.5rem', paddingBottom: '1.25rem', borderBottom: '1px solid #f1f5f9' }}>
              <p style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--secondary-color)', marginBottom: '0.75rem' }}>
                N1 · Volume Total Mensal (R$)
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
                {(['Faixa 1 (nota 1→3)', 'Faixa 2 (nota 3→5)', 'Faixa 3 (nota 5→7)', 'Faixa 4 (nota 7→9)'] as const).map((label, idx) => (
                  <div className="form-group" key={idx}>
                    <label className="form-label" style={{ fontSize: '0.72rem' }}>{label}</label>
                    <input
                      type="number" min={0} className="form-input"
                      style={{ padding: '0.35rem 0.5rem' }}
                      value={config.score_notas?.vol_total_faixas?.[idx] ?? [30000,80000,150000,300000][idx]}
                      onChange={(e) => handleFaixaChange('vol_total_faixas', idx, parseFloat(e.target.value) || 0)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* N2: Concentração */}
            <div style={{ marginBottom: '1.5rem', paddingBottom: '1.25rem', borderBottom: '1px solid #f1f5f9' }}>
              <p style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--secondary-color)', marginBottom: '0.75rem' }}>
                N2 · Concentração no Prata (%)
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
                {(['Faixa 1 (nota 1→3)', 'Faixa 2 (nota 3→5)', 'Faixa 3 (nota 5→7)', 'Faixa 4 (nota 7→9)'] as const).map((label, idx) => (
                  <div className="form-group" key={idx}>
                    <label className="form-label" style={{ fontSize: '0.72rem' }}>{label}</label>
                    <input
                      type="number" min={0} max={100} className="form-input"
                      style={{ padding: '0.35rem 0.5rem' }}
                      value={config.score_notas?.concentracao_faixas?.[idx] ?? [10,20,30,50][idx]}
                      onChange={(e) => handleFaixaChange('concentracao_faixas', idx, parseFloat(e.target.value) || 0)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* N3: Nº Vendedores */}
            <div>
              <p style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--secondary-color)', marginBottom: '0.75rem' }}>
                N3 · Estrutura (Nº de Vendedores)
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
                {(['Faixa 1 (nota 1→3)', 'Faixa 2 (nota 3→5)', 'Faixa 3 (nota 5→7)', 'Faixa 4 (nota 7→9)'] as const).map((label, idx) => (
                  <div className="form-group" key={idx}>
                    <label className="form-label" style={{ fontSize: '0.72rem' }}>{label}</label>
                    <input
                      type="number" min={0} className="form-input"
                      style={{ padding: '0.35rem 0.5rem' }}
                      value={config.score_notas?.vendedores_faixas?.[idx] ?? [1,3,5,10][idx]}
                      onChange={(e) => handleFaixaChange('vendedores_faixas', idx, parseFloat(e.target.value) || 0)}
                    />
                  </div>
                ))}
              </div>
            </div>

            <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Nota: Os critérios N4 (Abrangência), N5 (Produtos), N6 (Modelo de atuação) e N7 (Diversificação) usam categorias fixas
              e não possuem faixas numéricas configuráveis.
            </p>
          </div>

          {/* Botão de Gravar */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ padding: '0.8rem 2.5rem', fontSize: '1rem', fontWeight: 600 }}
              disabled={saving}
            >
              {saving ? 'Gravando Alterações...' : 'Salvar Todos os Critérios'}
            </button>
          </div>

        </div>
      </form>
    </div>
  );
}
