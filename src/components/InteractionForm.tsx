import React, { useEffect, useState } from 'react';
import { dataService } from '../services/dataService';
import { Parceiro, CrmLog } from '../types';
import { ClipboardList, AlertCircle } from 'lucide-react';

interface InteractionFormProps {
  initialPartnerId?: string;
  onSave: () => void;
  onCancel: () => void;
}

export default function InteractionForm({ initialPartnerId, onSave, onCancel }: InteractionFormProps) {
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState({
    parceiro_id: initialPartnerId || '',
    data_contato: new Date().toISOString().substring(0, 16),
    canal: 'WhatsApp' as CrmLog['canal'],
    resumo: '',
    proxima_acao: '',
    data_proxima_acao: '',
    crm_atualizado: true,
    
    // Diagnóstico
    diagnostico_causa: '',
    diagnostico_dor: '',
    diagnostico_motivador: '',
    diagnostico_concorrentes: '',
    diagnostico_interesse: '',
    diagnostico_objecao: '',
    diagnostico_gargalo: '',
    passos_acao_parceiro: '',
    passos_acao_interna: ''
  });

  useEffect(() => {
    async function loadPartners() {
      try {
        setLoading(true);
        const list = await dataService.getParceiros();
        setParceiros(list);
        
        if (initialPartnerId) {
          const selected = list.find(p => p.id === initialPartnerId);
          if (selected) {
            const nextDays = selected.classificacao === 'Estratégico' ? 7 : selected.classificacao === 'Crescimento' ? 15 : 1;
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + nextDays);
            setFormData(prev => ({
              ...prev,
              data_proxima_acao: nextDate.toISOString().substring(0, 10)
            }));
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    loadPartners();
  }, [initialPartnerId]);

  const handlePartnerChange = (partnerId: string) => {
    const selected = parceiros.find(p => p.id === partnerId);
    if (selected) {
      const nextDays = selected.classificacao === 'Estratégico' ? 7 : selected.classificacao === 'Crescimento' ? 15 : 1;
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + nextDays);

      setFormData(prev => ({
        ...prev,
        parceiro_id: partnerId,
        data_proxima_acao: nextDate.toISOString().substring(0, 10)
      }));
    } else {
      setFormData(prev => ({ ...prev, parceiro_id: partnerId }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.parceiro_id || !formData.resumo || !formData.proxima_acao || !formData.data_proxima_acao) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    const selected = parceiros.find(p => p.id === formData.parceiro_id);
    if (!selected) {
      alert('Parceiro selecionado inválido.');
      return;
    }

    // Derivar Processo Comercial
    const processoDerivado: CrmLog['processo'] = 
      selected.status === 'Onboarding' ? 'Hunter' :
      (selected.status === 'Inativo' || selected.status === 'Reativado') ? 'Win-back' : 'Farmer';

    try {
      const logToSave: CrmLog = {
        parceiro_id: formData.parceiro_id,
        data_contato: new Date(formData.data_contato).toISOString(),
        canal: formData.canal,
        processo: processoDerivado,
        resumo: formData.resumo,
        proxima_acao: formData.proxima_acao,
        data_proxima_acao: formData.data_proxima_acao,
        classificacao_pos_contato: selected.classificacao, // Copia a classificação do parceiro
        crm_atualizado: formData.crm_atualizado,
        score_no_momento: selected.score_comercial,
        diagnostico_causa: formData.diagnostico_causa,
        diagnostico_dor: formData.diagnostico_dor,
        diagnostico_motivador: formData.diagnostico_motivador,
        diagnostico_concorrentes: formData.diagnostico_concorrentes,
        diagnostico_interesse: formData.diagnostico_interesse,
        diagnostico_objecao: formData.diagnostico_objecao,
        diagnostico_gargalo: formData.diagnostico_gargalo,
        passos_acao_parceiro: formData.passos_acao_parceiro,
        passos_acao_interna: formData.passos_acao_interna
      };

      await dataService.saveLog(logToSave);
      onSave();
    } catch (err) {
      alert('Erro ao salvar registro de contato.');
    }
  };

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', fontSize: '1.1rem', fontWeight: 550 }}>Carregando formulário...</div>;
  }

  return (
    <div className="card fade-in" style={{ padding: '2rem', maxWidth: '820px', margin: '0 auto' }}>
      
      {/* Aviso Regra Inegociável */}
      <div style={{
        padding: '0.75rem 1rem',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: 'var(--warning-bg)',
        color: '#b45309',
        fontSize: '0.85rem',
        fontWeight: 600,
        marginBottom: '1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        border: '1px solid #fef3c7'
      }}>
        <AlertCircle size={18} />
        Regra Inegociável: Todo contato comercial deve ser registrado aqui em até 2 horas. Dado não registrado = dado perdido.
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--secondary-color)' }}>
          Registrar Interação Comercial (CRM Log)
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Preencha os detalhes e o questionário pós-reunião para registrar o histórico.</p>
      </div>

      <form onSubmit={handleSubmit}>
        
        {/* Bloco Geral */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Selecione o Parceiro *</label>
              <select 
                className="form-input" 
                required
                value={formData.parceiro_id}
                onChange={(e) => handlePartnerChange(e.target.value)}
              >
                <option value="">Selecione...</option>
                {parceiros.map(p => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Data/Hora do Contato *</label>
              <input 
                type="datetime-local" 
                required 
                className="form-input" 
                value={formData.data_contato}
                onChange={(e) => setFormData(prev => ({ ...prev, data_contato: e.target.value }))}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Canal de Contato *</label>
              <select 
                className="form-input"
                value={formData.canal}
                onChange={(e) => setFormData(prev => ({ ...prev, canal: e.target.value as any }))}
              >
                <option value="WhatsApp">WhatsApp</option>
                <option value="Ligação">Ligação (Call)</option>
                <option value="Reunião">Reunião presencial/vídeo</option>
                <option value="E-mail">E-mail</option>
              </select>
            </div>
            <div className="form-group" style={{ justifyContent: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.25rem' }}>
                <input 
                  type="checkbox" 
                  id="crm_atualizado"
                  checked={formData.crm_atualizado}
                  onChange={(e) => setFormData(prev => ({ ...prev, crm_atualizado: e.target.checked }))}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--primary-color)' }}
                />
                <label htmlFor="crm_atualizado" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--secondary-color)', cursor: 'pointer' }}>
                  Confirmar CRM Atualizado e Validado?
                </label>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Resumo da Interação (Máx 500 caract.) *</label>
            <textarea 
              rows={3} 
              maxLength={500} 
              required
              className="form-input" 
              placeholder="O que foi conversado? Resuma o diagnóstico comercial em poucas linhas..."
              value={formData.resumo}
              onChange={(e) => setFormData(prev => ({ ...prev, resumo: e.target.value }))}
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right' }}>
              {formData.resumo.length}/500 caracteres
            </span>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Próxima Ação Acordada *</label>
              <input 
                type="text" 
                required 
                placeholder="Ex: Enviar proposta de cashback por e-mail"
                className="form-input" 
                value={formData.proxima_acao}
                onChange={(e) => setFormData(prev => ({ ...prev, proxima_acao: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Data da Próxima Ação *</label>
              <input 
                type="date" 
                required 
                className="form-input" 
                value={formData.data_proxima_acao}
                onChange={(e) => setFormData(prev => ({ ...prev, data_proxima_acao: e.target.value }))}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Ação Interna a Executar</label>
            <input
              type="text"
              placeholder="Ex: Configurar comissão diferenciada na retaguarda"
              className="form-input"
              value={formData.passos_acao_interna}
              onChange={(e) => setFormData(prev => ({ ...prev, passos_acao_interna: e.target.value }))}
            />
          </div>
        </div>

        {/* Bloco Diagnóstico da Reunião (Questionário Opcional/Expansível) */}
        <details style={{
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)',
          padding: '1rem',
          backgroundColor: 'rgba(0, 0, 0, 0.02)',
          marginBottom: '1.5rem'
        }}>
          <summary style={{ fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', outline: 'none', color: 'var(--secondary-color)' }}>
            <ClipboardList size={18} /> Questionário Pós-Reunião / Diagnóstico Comercial (Expandir)
          </summary>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem' }}>
              DIAGNÓSTICO E DORES
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Causa Principal da Conversa</label>
                <input type="text" placeholder="Ex: Expansão de produtos, reclamação de taxa" className="form-input" value={formData.diagnostico_causa} onChange={(e) => setFormData(prev => ({ ...prev, diagnostico_causa: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Dor Principal Relatada</label>
                <input type="text" placeholder="Ex: Baixa aprovação no banco atual" className="form-input" value={formData.diagnostico_dor} onChange={(e) => setFormData(prev => ({ ...prev, diagnostico_dor: e.target.value }))} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Motivador Principal</label>
                <input type="text" placeholder="Ex: Taxa de comissão ou agilidade tecnológica" className="form-input" value={formData.diagnostico_motivador} onChange={(e) => setFormData(prev => ({ ...prev, diagnostico_motivador: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Concorrentes Mencionados</label>
                <input type="text" placeholder="Ex: Facta, V8, Hub" className="form-input" value={formData.diagnostico_concorrentes} onChange={(e) => setFormData(prev => ({ ...prev, diagnostico_concorrentes: e.target.value }))} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Produto com Maior Interesse</label>
                <input type="text" placeholder="Ex: FGTS BMS ou Pix no Cartão" className="form-input" value={formData.diagnostico_interesse} onChange={(e) => setFormData(prev => ({ ...prev, diagnostico_interesse: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Objeção Principal Levantada</label>
                <input type="text" placeholder="Ex: Medo de rejeição de cliente no Pix" className="form-input" value={formData.diagnostico_objecao} onChange={(e) => setFormData(prev => ({ ...prev, diagnostico_objecao: e.target.value }))} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Gargalo Operacional Identificado</label>
              <input type="text" placeholder="Ex: Falta de link ou suporte do Star Bank" className="form-input" value={formData.diagnostico_gargalo} onChange={(e) => setFormData(prev => ({ ...prev, diagnostico_gargalo: e.target.value }))} />
            </div>
          </div>
        </details>

        {/* Ações */}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '2rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Registrar no CRM</button>
        </div>

      </form>
    </div>
  );
}
