import React, { useEffect, useState } from 'react';
import { dataService } from '../services/dataService';
import { Parceiro } from '../types';
import { Search, Plus, Eye, Edit2, Trash2, X, Check, FileSpreadsheet } from 'lucide-react';

interface PartnersListProps {
  onSelectPartner: (id: string) => void;
}

export default function PartnersList({ onSelectPartner }: PartnersListProps) {
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  
  // Controle de Modal e Edição
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    nome: '',
    cnpj: '',
    contato_principal: '',
    whatsapp: '',
    email: '',
    modelo_atuacao: 'Físico' as Parceiro['modelo_atuacao'],
    area_geografica: 'Local' as Parceiro['area_geografica'],
    num_vendedores: 1,
    vol_total_mensal: 0,
    vol_prata_mensal: 0,
    propostas_pagas_semana: 0,
    produtos_ativos: [] as string[],
    concorrentes: '',
    status: 'Em prospecção' as Parceiro['status']
  });

  const loadPartners = async () => {
    try {
      setLoading(true);
      const list = await dataService.getParceiros();
      setParceiros(list);
    } catch (e) {
      console.error('Erro ao ler parceiros:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPartners();
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Tem certeza que deseja excluir o parceiro "${name}" do CRM? Todos os logs e histórico associados serão deletados.`)) {
      try {
        await dataService.deleteParceiro(id);
        await loadPartners();
      } catch (e) {
        alert('Erro ao excluir parceiro.');
      }
    }
  };

  const handleProductToggle = (prod: string) => {
    setFormData(prev => {
      const active = prev.produtos_ativos.includes(prod)
        ? prev.produtos_ativos.filter(p => p !== prod)
        : [...prev.produtos_ativos, prod];
      return { ...prev, produtos_ativos: active };
    });
  };

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

  const openAddModal = () => {
    setEditingId(null);
    setFormData({
      nome: '',
      cnpj: '',
      contato_principal: '',
      whatsapp: '',
      email: '',
      modelo_atuacao: 'Físico',
      area_geografica: 'Local',
      num_vendedores: 1,
      vol_total_mensal: 0,
      vol_prata_mensal: 0,
      propostas_pagas_semana: 0,
      produtos_ativos: [],
      concorrentes: '',
      status: 'Em prospecção'
    });
    setShowModal(true);
  };

  const openEditModal = (partner: Parceiro) => {
    setEditingId(partner.id);
    setFormData({
      nome: partner.nome,
      cnpj: partner.cnpj,
      contato_principal: partner.contato_principal,
      whatsapp: partner.whatsapp,
      email: partner.email || '',
      modelo_atuacao: partner.modelo_atuacao,
      area_geografica: partner.area_geografica,
      num_vendedores: partner.num_vendedores,
      vol_total_mensal: partner.vol_total_mensal,
      vol_prata_mensal: partner.vol_prata_mensal,
      propostas_pagas_semana: partner.propostas_pagas_semana || 0,
      produtos_ativos: partner.produtos_ativos || [],
      concorrentes: partner.concorrentes || '',
      status: partner.status
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nome || !formData.cnpj || !formData.contato_principal || !formData.whatsapp) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    try {
      const payload = editingId ? { id: editingId, ...formData } : formData;
      await dataService.saveParceiro(payload);
      setShowModal(false);
      await loadPartners();
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar parceiro.');
    }
  };

  // Importar Planilha .xlsx
  const handleImportXLSX = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import('xlsx');
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        if (data.length === 0) {
          alert('A planilha importada está vazia.');
          return;
        }

        let importados = 0;
        for (const row of data) {
          const nome = row.Nome || row['Razão Social'] || row.nome || row.razao_social;
          const cnpj = row.CNPJ || row.cnpj;
          const contato = row.Contato || row['Contato Principal'] || row.contato;
          const whatsapp = row.WhatsApp || row.whatsapp || row.telefone;
          const email = row.Email || row.email;
          const modelo = row.Modelo || row['Modelo de Atuação'] || row.modelo || 'Físico';
          const area = row.Area || row['Área Geográfica'] || row.area || 'Local';
          const vendedores = parseInt(row.Vendedores || row['Nº Vendedores'] || row.vendedores) || 1;
          const volTotal = parseFloat(row['Vol. Total'] || row['Volume Total'] || row.volume_total || 0);
          const volPrata = parseFloat(row['Vol. Prata'] || row['Volume Prata'] || row.volume_prata || 0);
          const propostasPagas = parseInt(row['Propostas Pagas'] || row['Propostas Pagas na Semana'] || row.propostas_pagas || 0);
          
          let produtos: string[] = [];
          if (row.Produtos || row['Produtos Ativos']) {
            const pStr = String(row.Produtos || row['Produtos Ativos']);
            produtos = pStr.split(',').map(s => s.trim().toUpperCase()).filter(s => ['FGTS', 'CLT', 'CGV', 'PIX'].includes(s));
          }

          if (nome && cnpj) {
            await dataService.saveParceiro({
              nome,
              cnpj,
              contato_principal: contato || 'Não Informado',
              whatsapp: whatsapp || 'Não Informado',
              email: email || '',
              modelo_atuacao: modelo as any,
              area_geografica: area as any,
              num_vendedores: vendedores,
              vol_total_mensal: volTotal,
              vol_prata_mensal: volPrata,
              produtos_ativos: produtos,
              propostas_pagas_semana: propostasPagas,
              status: 'Em prospecção'
            });
            importados++;
          }
        }

        alert(`${importados} parceiros importados com sucesso!`);
        await loadPartners();
      } catch (err) {
        console.error(err);
        alert('Erro ao processar planilha. Verifique se as colunas correspondem.');
      }
    };
    reader.readAsBinaryString(file);
  };

  const filteredParceiros = parceiros.filter(p => {
    const matchesSearch = p.nome.toLowerCase().includes(search.toLowerCase()) || 
                          (p.cnpj || '').includes(search);
    const matchesStatus = statusFilter ? p.status === statusFilter : true;
    const matchesClass = classFilter ? p.classificacao === classFilter : true;
    return matchesSearch && matchesStatus && matchesClass;
  });

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(val);
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ marginBottom: '2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--secondary-color)' }}>
            Carteira de Parceiros
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
            Gerencie promotoras e correspondentes cadastrados no CRM
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileSpreadsheet size={16} /> Importar XLSX
            <input 
              type="file" 
              accept=".xlsx, .xls" 
              onChange={handleImportXLSX} 
              style={{ display: 'none' }} 
            />
          </label>
          <button className="btn btn-primary" onClick={openAddModal}>
            <Plus size={18} /> Adicionar Parceiro
          </button>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '260px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            className="form-input"
            style={{ paddingLeft: '40px' }}
            placeholder="Buscar por Razão Social ou CNPJ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={{ width: '180px' }}>
          <select 
            className="form-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Todos Status</option>
            <option value="Ativo">Ativo</option>
            <option value="Inativo">Inativo</option>
            <option value="Em prospecção">Em prospecção</option>
            <option value="Em reativação">Em reativação</option>
          </select>
        </div>

        <div style={{ width: '180px' }}>
          <select 
            className="form-input"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
          >
            <option value="">Todas Classificações</option>
            <option value="Estratégico">⭐ Estratégico</option>
            <option value="Crescimento">🔼 Crescimento</option>
            <option value="Reativação">🔄 Reativação</option>
            <option value="Prospecção">🆕 Prospecção</option>
          </select>
        </div>
      </div>

      {/* Tabela de Parceiros */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', fontSize: '1.1rem', fontWeight: 550 }}>Carregando carteira de parceiros...</div>
      ) : filteredParceiros.length === 0 ? (
        <div className="card" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Nenhum parceiro encontrado com os filtros selecionados.
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Parceiro / Razão Social</th>
                <th>CNPJ</th>
                <th>Contato</th>
                <th>WhatsApp</th>
                <th>Score / Classificação</th>
                <th style={{ textAlign: 'right' }}>Vol. Prata</th>
                <th>Status</th>
                <th style={{ textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredParceiros.map((p) => {
                const conc = p.vol_total_mensal > 0 ? (p.vol_prata_mensal / p.vol_total_mensal) * 100 : 0;
                return (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--secondary-color)' }}>{p.nome}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.modelo_atuacao} · {p.area_geografica}</div>
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{p.cnpj}</td>
                    <td>{p.contato_principal}</td>
                    <td>{p.whatsapp}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className={`badge ${p.score_comercial >= 80 ? 'badge-success' : p.score_comercial >= 50 ? 'badge-info' : 'badge-warning'}`} style={{ minWidth: '32px', textAlign: 'center' }}>
                          {p.score_comercial}
                        </span>
                        <span style={{ fontSize: '0.85rem', fontWeight: 650, color: 'var(--secondary-color)' }}>
                          {p.classificacao}
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {formatCurrency(p.vol_prata_mensal)}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>conc. {conc.toFixed(0)}%</div>
                    </td>
                    <td>
                      <span className={`badge ${
                        p.status === 'Ativo' ? 'badge-success' : 
                        p.status === 'Inativo' ? 'badge-danger' : 
                        p.status === 'Em reativação' ? 'badge-warning' : 'badge-info'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                        <button className="btn btn-secondary btn-icon" onClick={() => onSelectPartner(p.id)} title="Visualizar Detalhes">
                          <Eye size={15} />
                        </button>
                        <button className="btn btn-secondary btn-icon" onClick={() => openEditModal(p)} title="Editar Cadastro">
                          <Edit2 size={15} />
                        </button>
                        <button className="btn btn-secondary btn-icon" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(p.id, p.nome)} title="Excluir Parceiro">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de Adicionar/Editar Parceiro */}
      {showModal && (
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
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            marginBottom: '2rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--secondary-color)' }}>
                {editingId ? 'Editar Cadastro do Parceiro' : 'Adicionar Novo Parceiro B2B'}
              </h3>
              <button onClick={() => setShowModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
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
                  <label className="form-label">WhatsApp *</label>
                  <input type="text" required placeholder="(00) 00000-0000" className="form-input" value={formData.whatsapp} onChange={(e) => setFormData(prev => ({ ...prev, whatsapp: e.target.value }))} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">E-mail Comercial</label>
                <input type="email" placeholder="contato@parceiro.com.br" className="form-input" value={formData.email} onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))} />
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
                  <input type="number" min={1} required className="form-input" value={formData.num_vendedores} onChange={(e) => setFormData(prev => ({ ...prev, num_vendedores: parseInt(e.target.value) || 1 }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Propostas Pagas na Semana (Farmer)</label>
                  <input type="number" min={0} className="form-input" value={formData.propostas_pagas_semana} onChange={(e) => setFormData(prev => ({ ...prev, propostas_pagas_semana: parseInt(e.target.value) || 0 }))} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Vol. Total Mensal Declarado (R$) *</label>
                  <input type="number" min={0} required className="form-input" value={formData.vol_total_mensal} onChange={(e) => setFormData(prev => ({ ...prev, vol_total_mensal: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Concorrentes Declarados</label>
                  <input type="text" placeholder="Ex: Facta, V8, Hub" className="form-input" value={formData.concorrentes} onChange={(e) => setFormData(prev => ({ ...prev, concorrentes: e.target.value }))} />
                </div>
              </div>

              <div className="form-group" style={{ margin: '1rem 0' }}>
                <label className="form-label" style={{ marginBottom: '0.5rem' }}>Produtos Ativos no Saque/Prata Digital</label>
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
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">
                  {editingId ? 'Salvar Alterações' : 'Criar Parceiro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
