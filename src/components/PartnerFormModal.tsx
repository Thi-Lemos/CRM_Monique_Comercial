import React, { useEffect, useState } from 'react';
import { dataService } from '../services/dataService';
import { Parceiro } from '../types';
import { X, Check } from 'lucide-react';
import CurrencyInput from './CurrencyInput';

interface PartnerFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  partner: Parceiro | null;
  onSave: () => void;
}

const getLastThreeMonths = () => {
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const hoje = new Date();
  const res = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    res.push(months[d.getMonth()]);
  }
  return res;
};

export default function PartnerFormModal({ isOpen, onClose, partner, onSave }: PartnerFormModalProps) {
  const [formData, setFormData] = useState({
    nome: '',
    cnpj: '',
    contato_principal: '',
    email: '',
    modelo_atuacao: 'Físico' as Parceiro['modelo_atuacao'],
    area_geografica: 'Local' as Parceiro['area_geografica'],
    num_vendedores: 1,
    vol_total_mensal: 0,
    vol_prata_mensal: 0,
    propostas_pagas_semana: 0,
    produtos_ativos: [] as string[],
    concorrentes: '',
    status: 'Onboarding' as Parceiro['status'],
    vol_total_detalhes: {
      mes1: '',
      valor1: 0,
      mes2: '',
      valor2: 0,
      mes3: '',
      valor3: 0
    }
  });

  useEffect(() => {
    if (isOpen) {
      const defaultMonths = getLastThreeMonths();
      if (partner) {
        setFormData({
          nome: partner.nome,
          cnpj: partner.cnpj,
          contato_principal: partner.contato_principal,
          email: partner.email || '',
          modelo_atuacao: partner.modelo_atuacao,
          area_geografica: partner.area_geografica,
          num_vendedores: partner.num_vendedores,
          vol_total_mensal: partner.vol_total_mensal,
          vol_prata_mensal: partner.vol_prata_mensal,
          propostas_pagas_semana: partner.propostas_pagas_semana || 0,
          produtos_ativos: partner.produtos_ativos || [],
          concorrentes: partner.concorrentes || '',
          status: partner.status,
          vol_total_detalhes: partner.vol_total_detalhes || {
            mes1: defaultMonths[0],
            valor1: partner.vol_total_mensal || 0,
            mes2: defaultMonths[1],
            valor2: 0,
            mes3: defaultMonths[2],
            valor3: 0
          }
        });
      } else {
        setFormData({
          nome: '',
          cnpj: '',
          contato_principal: '',
          email: '',
          modelo_atuacao: 'Físico',
          area_geografica: 'Local',
          num_vendedores: 1,
          vol_total_mensal: 0,
          vol_prata_mensal: 0,
          propostas_pagas_semana: 0,
          produtos_ativos: [],
          concorrentes: '',
          status: 'Onboarding',
          vol_total_detalhes: {
            mes1: defaultMonths[0],
            valor1: 0,
            mes2: defaultMonths[1],
            valor2: 0,
            mes3: defaultMonths[2],
            valor3: 0
          }
        });
      }
    }
  }, [isOpen, partner]);

  if (!isOpen) return null;

  const formatCNPJ = (val: string) => {
    const clean = val.replace(/\D/g, '');
    if (clean.length <= 14) {
      return clean
        .replace(/^(\d{2})(\d)/, '$1.$2')
        .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2')
        .replace(/(\d{4})(\d)/, '$1-$2');
    }
    return val;
  };

  const handleCNPJChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setFormData(prev => ({ ...prev, cnpj: formatCNPJ(raw) }));
  };

  const handleProductToggle = (prod: string) => {
    setFormData(prev => {
      const active = prev.produtos_ativos.includes(prod)
        ? prev.produtos_ativos.filter(p => p !== prod)
        : [...prev.produtos_ativos, prod];
      return { ...prev, produtos_ativos: active };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nome || !formData.cnpj || !formData.contato_principal) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    try {
      const vals = [
        formData.vol_total_detalhes.valor1,
        formData.vol_total_detalhes.valor2,
        formData.vol_total_detalhes.valor3
      ].filter(v => v > 0);
      const media = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;

      const payload = {
        ...formData,
        vol_total_mensal: media,
        ...(partner ? { id: partner.id } : {})
      };
      await dataService.saveParceiro(payload);
      onSave();
      onClose();
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar parceiro.');
    }
  };

  return (
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
        maxWidth: '960px',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        backgroundColor: 'rgba(209, 250, 237, 0.95)',
        border: '1px solid rgba(15, 184, 130, 0.35)',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--secondary-color)' }}>
            {partner ? 'Editar Cadastro do Parceiro' : 'Adicionar Novo Parceiro B2B'}
          </h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Razão Social / Nome Fantasia *</label>
              <input type="text" required className="form-input" value={formData.nome} onChange={(e) => setFormData(prev => ({ ...prev, nome: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">CNPJ *</label>
              <input type="text" required placeholder="00.000.000/0000-00" className="form-input" value={formData.cnpj} onChange={handleCNPJChange} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Contato Principal *</label>
              <input type="text" required placeholder="Ex: Carlos Silva" className="form-input" value={formData.contato_principal} onChange={(e) => setFormData(prev => ({ ...prev, contato_principal: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">E-mail Comercial</label>
              <input type="email" placeholder="contato@parceiro.com.br" className="form-input" value={formData.email} onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Modelo de Atuação *</label>
              <select className="form-input" value={formData.modelo_atuacao} onChange={(e) => setFormData(prev => ({ ...prev, modelo_atuacao: e.target.value as any }))}>
                <option value="Físico">Físico</option>
                <option value="Digital">Digital</option>
                <option value="Pastinhas">Pastinhas</option>
                <option value="Híbrido">Híbrido</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Área Geográfica *</label>
              <select className="form-input" value={formData.area_geografica} onChange={(e) => setFormData(prev => ({ ...prev, area_geografica: e.target.value as any }))}>
                <option value="Local">Local</option>
                <option value="Regional">Regional</option>
                <option value="Estadual">Estadual</option>
                <option value="Nacional">Nacional</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Nº de Vendedores *</label>
              <input type="number" min={1} required className="form-input no-spinner" value={formData.num_vendedores} onChange={(e) => setFormData(prev => ({ ...prev, num_vendedores: parseInt(e.target.value) || 1 }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Propostas Pagas na Semana (Farmer)</label>
              <input type="number" min={0} className="form-input no-spinner" value={formData.propostas_pagas_semana} onChange={(e) => setFormData(prev => ({ ...prev, propostas_pagas_semana: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>

          <div style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', marginBottom: '1.25rem', backgroundColor: 'rgba(255, 255, 255, 0.4)' }}>
            <label className="form-label" style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Volumes TOTAL dos Últimos 3 Meses</label>
            
            {/* Mes 1 */}
            <div className="form-row" style={{ marginBottom: '0.75rem', alignItems: 'center' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.8rem' }}>Mês 1</label>
                <select 
                  className="form-input" 
                  value={formData.vol_total_detalhes.mes1} 
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    vol_total_detalhes: { ...prev.vol_total_detalhes, mes1: e.target.value }
                  }))}
                >
                  {['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.8rem' }}>Volume (R$)</label>
                <CurrencyInput
                  value={formData.vol_total_detalhes.valor1}
                  onChange={(val) => setFormData(prev => ({
                    ...prev,
                    vol_total_detalhes: { ...prev.vol_total_detalhes, valor1: val }
                  }))}
                />
              </div>
            </div>

            {/* Mes 2 */}
            <div className="form-row" style={{ marginBottom: '0.75rem', alignItems: 'center' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.8rem' }}>Mês 2</label>
                <select 
                  className="form-input" 
                  value={formData.vol_total_detalhes.mes2} 
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    vol_total_detalhes: { ...prev.vol_total_detalhes, mes2: e.target.value }
                  }))}
                >
                  {['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.8rem' }}>Volume (R$)</label>
                <CurrencyInput
                  value={formData.vol_total_detalhes.valor2}
                  onChange={(val) => setFormData(prev => ({
                    ...prev,
                    vol_total_detalhes: { ...prev.vol_total_detalhes, valor2: val }
                  }))}
                />
              </div>
            </div>

            {/* Mes 3 */}
            <div className="form-row" style={{ marginBottom: '0.75rem', alignItems: 'center' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.8rem' }}>Mês 3</label>
                <select 
                  className="form-input" 
                  value={formData.vol_total_detalhes.mes3} 
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    vol_total_detalhes: { ...prev.vol_total_detalhes, mes3: e.target.value }
                  }))}
                >
                  {['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.8rem' }}>Volume (R$)</label>
                <CurrencyInput
                  value={formData.vol_total_detalhes.valor3}
                  onChange={(val) => setFormData(prev => ({
                    ...prev,
                    vol_total_detalhes: { ...prev.vol_total_detalhes, valor3: val }
                  }))}
                />
              </div>
            </div>

            {/* Média Calculada */}
            <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: 700, color: 'var(--secondary-color)' }}>
              Média Estimada (Calculada automaticamente): {
                new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                  [formData.vol_total_detalhes.valor1, formData.vol_total_detalhes.valor2, formData.vol_total_detalhes.valor3].filter(v => v > 0).length > 0
                    ? [formData.vol_total_detalhes.valor1, formData.vol_total_detalhes.valor2, formData.vol_total_detalhes.valor3].filter(v => v > 0).reduce((a, b) => a + b, 0) / [formData.vol_total_detalhes.valor1, formData.vol_total_detalhes.valor2, formData.vol_total_detalhes.valor3].filter(v => v > 0).length
                    : 0
                )
              }
            </div>
          </div>

          <div className="form-row">
            <div className="form-group" style={{ width: '100%' }}>
              <label className="form-label">Concorrentes Declarados</label>
              <input type="text" placeholder="Ex: Facta, V8, Hub" className="form-input" value={formData.concorrentes} onChange={(e) => setFormData(prev => ({ ...prev, concorrentes: e.target.value }))} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-input" value={formData.status} onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as any }))}>
                <option value="Ativo">Ativo</option>
                <option value="Onboarding">Onboarding</option>
                <option value="Reativado">Reativado</option>
                <option value="Inativo">Inativo</option>
              </select>
            </div>
          </div>

          <div className="form-group" style={{ margin: '1rem 0' }}>
            <label className="form-label" style={{ marginBottom: '0.5rem' }}>Produtos ativos no Prata Digital</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {['FGTS', 'CLT', 'CGV', 'Pix'].map(prod => {
                const isChecked = formData.produtos_ativos.includes(prod);
                return (
                  <button
                    key={prod}
                    type="button"
                    onClick={() => handleProductToggle(prod)}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid',
                      borderColor: isChecked ? 'var(--primary-color)' : 'var(--border-color)',
                      backgroundColor: isChecked ? 'rgba(15, 184, 130, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                      color: isChecked ? 'var(--primary-hover)' : 'var(--text-main)',
                      fontWeight: isChecked ? 600 : 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      transition: 'var(--transition)'
                    }}
                  >
                    {isChecked && <Check size={14} />}
                    {prod === 'Pix' ? 'Pix no Cartão' : prod}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '2rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary">
              {partner ? 'Salvar Alterações' : 'Salvar Parceiro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
