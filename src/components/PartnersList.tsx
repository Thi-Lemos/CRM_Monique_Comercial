import React, { useEffect, useState } from 'react';
import { dataService, getVolPrataUltimaProducao } from '../services/dataService';
import { Parceiro, ProducaoMensal } from '../types';
import { Search, Plus, Edit2, Trash2, FileSpreadsheet } from 'lucide-react';
import PartnerFormModal from './PartnerFormModal';

// Cadastro de parceiros passou a ser feito diretamente no CRM. Import em massa via
// planilha fica desativado na UI (mas preservado no código para uso pontual por dev).
const IMPORTACAO_XLSX_HABILITADA = false;

interface PartnersListProps {
  onSelectPartner: (id: string) => void;
}

export default function PartnersList({ onSelectPartner }: PartnersListProps) {
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const [allProducoes, setAllProducoes] = useState<ProducaoMensal[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [ascendingOrder, setAscendingOrder] = useState(false);
  
  // Controle de Modal e Edição
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedPartnerForEdit, setSelectedPartnerForEdit] = useState<Parceiro | null>(null);

  const loadPartners = async () => {
    try {
      setLoading(true);
      const [list, prods] = await Promise.all([
        dataService.getParceiros(),
        dataService.getAllProducao()
      ]);
      setParceiros(list);
      setAllProducoes(prods);
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

  const openAddModal = () => {
    setSelectedPartnerForEdit(null);
    setIsFormOpen(true);
  };

  const openEditModal = (partner: Parceiro) => {
    setSelectedPartnerForEdit(partner);
    setIsFormOpen(true);
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
              email: email || '',
              modelo_atuacao: modelo as any,
              area_geografica: area as any,
              num_vendedores: vendedores,
              vol_total_mensal: volTotal,
              vol_prata_mensal: volPrata,
              produtos_ativos: produtos,
              propostas_pagas_semana: propostasPagas,
              status: 'Inativo',
              created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
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

  // Vol. Prata exibido é sempre o da última produção lançada para o parceiro,
  // independente de mês/período — a Carteira não usa mais seletor de período.
  const prodsPorParceiro: Record<string, ProducaoMensal[]> = {};
  allProducoes.forEach(prod => {
    if (!prodsPorParceiro[prod.parceiro_id]) {
      prodsPorParceiro[prod.parceiro_id] = [];
    }
    prodsPorParceiro[prod.parceiro_id].push(prod);
  });

  const parceirosComVolAtual = parceiros.map(p => ({
    ...p,
    vol_prata_mensal: getVolPrataUltimaProducao(prodsPorParceiro[p.id] || [])
  }));

  const filteredParceiros = parceirosComVolAtual.filter(p => {
    const matchesSearch = p.nome.toLowerCase().includes(search.toLowerCase()) || 
                          (p.cnpj || '').includes(search);
    const matchesStatus = statusFilter ? p.status === statusFilter : true;
    const matchesClass = classFilter ? p.classificacao === classFilter : true;
    return matchesSearch && matchesStatus && matchesClass;
  });

  const sortedAndFilteredParceiros = [...filteredParceiros].sort((a, b) => {
    const volA = a.vol_prata_mensal || 0;
    const volB = b.vol_prata_mensal || 0;
    return ascendingOrder ? volA - volB : volB - volA;
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
        
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {IMPORTACAO_XLSX_HABILITADA && (
            <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, height: '36px' }}>
              <FileSpreadsheet size={16} /> Importar XLSX
              <input 
                type="file" 
                accept=".xlsx, .xls" 
                onChange={handleImportXLSX} 
                style={{ display: 'none' }} 
              />
            </label>
          )}
          <button className="btn btn-primary" onClick={openAddModal} style={{ height: '36px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
            <option value="Onboarding">Onboarding</option>
            <option value="Reativado">Reativado</option>
            <option value="Inativo">Inativo</option>
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
            <option value="Desenvolvimento">🛠️ Desenvolvimento</option>
          </select>
        </div>

        {/* Checkbox de Ordenação Crescente */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem' }}>
          <input 
            type="checkbox"
            id="ascendingOrder"
            checked={ascendingOrder}
            onChange={(e) => setAscendingOrder(e.target.checked)}
            style={{
              width: '16px',
              height: '16px',
              cursor: 'pointer',
              accentColor: 'var(--primary-color)'
            }}
          />
          <label 
            htmlFor="ascendingOrder" 
            style={{ 
              fontSize: '0.85rem', 
              fontWeight: 600, 
              color: 'var(--text-main)', 
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            Ordem Crescente (Volume Prata)
          </label>
        </div>
      </div>

      {/* Tabela de Parceiros */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', fontSize: '1.1rem', fontWeight: 550 }}>Carregando carteira de parceiros...</div>
      ) : sortedAndFilteredParceiros.length === 0 ? (
        <div className="card" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Nenhum parceiro encontrado com os filtros selecionados.
        </div>
      ) : (
        <div className="table-container" style={{ maxHeight: '600px', overflowY: 'auto' }}>
          <table className="table" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', top: 0, backgroundColor: 'var(--primary-color)', color: '#ffffff', zIndex: 10, borderBottom: '1px solid rgba(255, 255, 255, 0.15)', fontWeight: 800 }}>Parceiro / Razão Social</th>
                <th style={{ position: 'sticky', top: 0, backgroundColor: 'var(--primary-color)', color: '#ffffff', zIndex: 10, borderBottom: '1px solid rgba(255, 255, 255, 0.15)', fontWeight: 800 }}>CNPJ</th>
                <th style={{ position: 'sticky', top: 0, backgroundColor: 'var(--primary-color)', color: '#ffffff', zIndex: 10, borderBottom: '1px solid rgba(255, 255, 255, 0.15)', fontWeight: 800 }}>Contato</th>
                <th style={{ position: 'sticky', top: 0, backgroundColor: 'var(--primary-color)', color: '#ffffff', zIndex: 10, borderBottom: '1px solid rgba(255, 255, 255, 0.15)', fontWeight: 800 }}>Score / Classificação</th>
                <th style={{ position: 'sticky', top: 0, backgroundColor: 'var(--primary-color)', color: '#ffffff', zIndex: 10, borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'right', fontWeight: 800 }}>Vol. Prata</th>
                <th style={{ position: 'sticky', top: 0, backgroundColor: 'var(--primary-color)', color: '#ffffff', zIndex: 10, borderBottom: '1px solid rgba(255, 255, 255, 0.15)', fontWeight: 800 }}>Status</th>
                <th style={{ position: 'sticky', top: 0, backgroundColor: 'var(--primary-color)', color: '#ffffff', zIndex: 10, borderBottom: '1px solid rgba(255, 255, 255, 0.15)', textAlign: 'center', fontWeight: 800 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFilteredParceiros.map((p) => {
                const concText = p.vol_total_mensal > 0 ? `${((p.vol_prata_mensal / p.vol_total_mensal) * 100).toFixed(0)}%` : 'NVT';
                return (
                  <tr 
                    key={p.id}
                    onClick={() => onSelectPartner(p.id)}
                    onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'rgba(15, 184, 130, 0.08)'}
                    onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.backgroundColor = ''}
                    style={{ transition: 'background-color 0.2s ease', cursor: 'pointer' }}
                  >
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--secondary-color)' }}>{p.nome}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.modelo_atuacao} · {p.area_geografica}</div>
                    </td>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{p.cnpj}</td>
                    <td>{p.contato_principal}</td>
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
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>conc. {concText}</div>
                    </td>
                    <td>
                      <span className={`badge ${
                        p.status === 'Ativo' ? 'badge-success' : 
                        p.status === 'Inativo' ? 'badge-danger' :
                        p.status === 'Reativado' ? 'badge-warning' : 'badge-info'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                        <button className="btn btn-secondary btn-icon" onClick={(e) => { e.stopPropagation(); openEditModal(p); }} title="Editar Cadastro">
                          <Edit2 size={15} />
                        </button>
                        <button className="btn btn-secondary btn-icon" style={{ color: 'var(--danger)' }} onClick={(e) => { e.stopPropagation(); handleDelete(p.id, p.nome); }} title="Excluir Parceiro">
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

      <PartnerFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        partner={selectedPartnerForEdit}
        onSave={loadPartners}
      />
    </div>
  );
}
