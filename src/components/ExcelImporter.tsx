import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { dataService } from '../services/dataService';
import { Upload, X, CheckCircle2, RefreshCw, Layers } from 'lucide-react';

interface ExcelImporterProps {
  onClose: () => void;
  onImportSuccess: () => void;
}

interface LogEntry {
  type: 'info' | 'success' | 'error';
  message: string;
}

export default function ExcelImporter({ onClose, onImportSuccess }: ExcelImporterProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [overrideLast, setOverrideLast] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState<{
    totalRows: number;
    processed: number;
    errors: number;
    totalVol: number;
  } | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls') || droppedFile.name.endsWith('.csv')) {
        setFile(droppedFile);
        addLog('info', `Arquivo selecionado: ${droppedFile.name}`);
      } else {
        addLog('error', 'Formato de arquivo inválido. Por favor, envie uma planilha .xlsx, .xls ou .csv.');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      addLog('info', `Arquivo selecionado: ${selectedFile.name}`);
    }
  };

  const handleImportSuccessCallback = onImportSuccess;

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, { type, message }]);
  };

  const processFile = async () => {
    if (!file) return;

    try {
      setLoading(true);
      setLogs([]);
      setSummary(null);
      setProgress(5);
      addLog('info', 'Iniciando leitura do arquivo...');

      const reader = new FileReader();
      
      reader.onload = async (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // Converter planilha em array de objetos JSON
          const rawRows = XLSX.utils.sheet_to_json<any>(worksheet);
          
          if (rawRows.length === 0) {
            addLog('error', 'A planilha selecionada está vazia.');
            setLoading(false);
            return;
          }

          addLog('info', `Planilha lida com sucesso. Encontradas ${rawRows.length} linhas de dados.`);
          setProgress(15);

          // Carregar todos os parceiros para mapear pelo CNPJ
          const parceiros = await dataService.getParceiros();
          let processedCount = 0;
          let errorCount = 0;
          let totalVolumeAcumulado = 0;

          // Limpar logs e preparar para o processamento linha a linha
          setProgress(25);

          for (let i = 0; i < rawRows.length; i++) {
            const row = rawRows[i];
            const cnpjRaw = String(row.cnpj || '').trim();
            const ano = parseInt(row.ano);
            const mes = parseInt(row.mes);

            // Validação de colunas básicas
            if (!cnpjRaw || isNaN(ano) || isNaN(mes)) {
              errorCount++;
              addLog('error', `Linha ${i + 2}: Dados inválidos (CNPJ, Ano ou Mês ausentes).`);
              continue;
            }

            // Procurar parceiro cadastrado com o CNPJ correspondente (limpando pontuações)
            const cleanCnpj = cnpjRaw.replace(/[^\d]/g, '');
            const parceiro = parceiros.find(p => p.cnpj.replace(/[^\d]/g, '') === cleanCnpj);

            if (!parceiro) {
              errorCount++;
              addLog('error', `Linha ${i + 2}: Parceiro com CNPJ ${cnpjRaw} não está cadastrado no CRM.`);
              continue;
            }

            // Coletar faturamentos e propostas
            const vol_fgts = parseFloat(row.vol_fgts || 0);
            const vol_clt = parseFloat(row.vol_clt || 0);
            const vol_cgv = parseFloat(row.vol_cgv || 0);
            const vol_pix = parseFloat(row.vol_pix || 0);
            const propostas_pagas = parseInt(row.propostas_pagas || row.propostas || 0);

            const lancamento = {
              parceiro_id: parceiro.id,
              ano,
              mes,
              vol_fgts,
              vol_clt,
              vol_cgv,
              vol_pix,
              propostas_pagas
            };

            try {
              // Salvar produção semanal chamando a lógica de auto-incremento inteligente
              const salvo = await dataService.saveProducaoSemanal(lancamento, overrideLast);
              processedCount++;
              const volLinha = (salvo.vol_fgts || 0) + (salvo.vol_clt || 0) + (salvo.vol_cgv || 0) + (salvo.vol_pix || 0);
              totalVolumeAcumulado += volLinha;

              addLog('success', `${parceiro.nome}: Registrada Semana ${salvo.semana} para ${mes}/${ano} no valor de R$ ${volLinha.toLocaleString('pt-BR')} (${salvo.propostas_pagas} propostas)`);
            } catch (err: any) {
              errorCount++;
              addLog('error', `Erro ao salvar faturamento de ${parceiro.nome}: ${err.message || 'Erro desconhecido'}`);
            }

            // Atualizar barra de progresso proporcionalmente
            const p = Math.round(25 + ((i + 1) / rawRows.length) * 75);
            setProgress(Math.min(99, p));
          }

          setProgress(100);
          addLog('info', 'Processamento concluído.');
          
          setSummary({
            totalRows: rawRows.length,
            processed: processedCount,
            errors: errorCount,
            totalVol: totalVolumeAcumulado
          });
          
          if (processedCount > 0) {
            handleImportSuccessCallback();
          }

        } catch (err: any) {
          addLog('error', `Falha ao processar o arquivo: ${err.message || 'Formato incorreto'}`);
        } finally {
          setLoading(false);
        }
      };

      reader.readAsBinaryString(file);

    } catch (e: any) {
      addLog('error', `Erro ao abrir leitor de arquivos: ${e.message}`);
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(15, 23, 42, 0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      backdropFilter: 'blur(4px)'
    }}>
      <div className="card modal-card animate-scale" style={{
        width: '100%',
        maxWidth: '650px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        padding: 0,
        boxShadow: 'var(--shadow-lg)',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.1)'
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
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--secondary-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Upload size={20} style={{ color: 'var(--primary-color)' }} /> Importar Planilha de Produção Semanal
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
              Carregue faturamentos da Prata Digital por parceiro com consolidação mensal automática.
            </p>
          </div>
          <button onClick={onClose} className="btn-close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {/* Corpo do Modal */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          
          {/* Zona de Drop */}
          {!loading && !summary && (
            <div 
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              style={{
                border: '2px dashed var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                padding: '2.5rem 1.5rem',
                textAlign: 'center',
                backgroundColor: file ? 'rgba(15, 184, 130, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                cursor: 'pointer',
                transition: 'border-color 0.2s',
                borderColor: file ? 'var(--primary-color)' : 'var(--border-color)'
              }}
              onClick={() => document.getElementById('file-upload-input')?.click()}
            >
              <input 
                id="file-upload-input"
                type="file" 
                accept=".xlsx,.xls,.csv" 
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  padding: '0.75rem',
                  borderRadius: '50%',
                  backgroundColor: file ? 'rgba(15, 184, 130, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  color: file ? 'var(--primary-color)' : 'var(--text-muted)'
                }}>
                  <Upload size={28} />
                </div>
                <div>
                  <p style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                    {file ? file.name : 'Arraste a planilha semanal aqui'}
                  </p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    ou clique para procurar no computador (.xlsx, .xls ou .csv)
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Configuração de Importação (Acumular vs Sobrescrever) */}
          {!loading && !summary && file && (
            <div style={{
              marginTop: '1.25rem',
              padding: '1rem',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(15, 23, 42, 0.3)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Modo de Carga
              </span>
              
              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.25rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 550 }}>
                  <input 
                    type="radio" 
                    name="mode" 
                    checked={!overrideLast} 
                    onChange={() => setOverrideLast(false)}
                    style={{ accentColor: 'var(--primary-color)' }}
                  />
                  Acumular como nova semana (Padrão)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 550 }}>
                  <input 
                    type="radio" 
                    name="mode" 
                    checked={overrideLast} 
                    onChange={() => setOverrideLast(true)}
                    style={{ accentColor: 'var(--primary-color)' }}
                  />
                  Sobrescrever última semana faturada
                </label>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem', lineHeight: 1.3 }}>
                {!overrideLast 
                  ? '💡 Cada carregamento semanal incrementa uma semana para o parceiro no mês correspondente, totalizando até 5 semanas.'
                  : '💡 Substitui o faturamento da última semana existente do parceiro no mês. Ideal para correções de lotes com erros.'
                }
              </p>
            </div>
          )}

          {/* Barra de Progresso do Processamento */}
          {loading && (
            <div style={{ margin: '1.5rem 0', textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>
                <span>Processando planilha comercial...</span>
                <span>{progress}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', borderRadius: '4px', backgroundColor: 'rgba(255, 255, 255, 0.05)', overflow: 'hidden' }}>
                <div style={{ width: `${progress}%`, height: '100%', backgroundColor: 'var(--primary-color)', transition: 'width 0.2s ease-in-out' }}></div>
              </div>
            </div>
          )}

          {/* Resumo pós Carga */}
          {summary && (
            <div style={{
              margin: '1rem 0',
              padding: '1.25rem',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '1rem'
            }}>
              <CheckCircle2 size={24} style={{ color: 'var(--primary-color)', marginTop: '0.1rem' }} />
              <div>
                <h4 style={{ fontWeight: 750, color: 'var(--secondary-color)', fontSize: '1rem' }}>Importação Semanal Concluída!</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginTop: '0.75rem', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Linhas Lidas:</span>{' '}
                    <strong style={{ color: 'var(--text-main)' }}>{summary.totalRows}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Atualizadas com sucesso:</span>{' '}
                    <strong style={{ color: 'var(--primary-color)' }}>{summary.processed}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Registros com erros:</span>{' '}
                    <strong style={{ color: summary.errors > 0 ? 'var(--danger)' : 'var(--text-main)' }}>{summary.errors}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Faturamento Novo Prata:</span>{' '}
                    <strong style={{ color: 'var(--secondary-color)' }}>R$ {summary.totalVol.toLocaleString('pt-BR')}</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Painel de Logs de Execução */}
          {(logs.length > 0) && (
            <div style={{ marginTop: '1.25rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}>
                Histórico de Carga
              </span>
              <div style={{
                maxHeight: '180px',
                overflowY: 'auto',
                backgroundColor: '#0f172a',
                color: '#e2e8f0',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                lineHeight: 1.4,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem'
              }}>
                {logs.map((log, index) => (
                  <div key={index} style={{
                    color: log.type === 'success' ? '#10b981' : log.type === 'error' ? '#ef4444' : '#94a3b8'
                  }}>
                    {log.type === 'success' && '✓ '}
                    {log.type === 'error' && '✗ '}
                    {log.type === 'info' && '• '}
                    {log.message}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Rodapé de Ações */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-color)',
          backgroundColor: 'rgba(7, 12, 20, 0.45)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.75rem',
          borderBottomLeftRadius: 'var(--radius-md)',
          borderBottomRightRadius: 'var(--radius-md)'
        }}>
          {!summary ? (
            <>
              <button onClick={onClose} disabled={loading} className="btn btn-secondary">
                Cancelar
              </button>
              <button 
                onClick={processFile} 
                disabled={!file || loading} 
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                {loading ? <RefreshCw size={16} className="animate-spin" /> : <Layers size={16} />}
                {loading ? 'Processando...' : 'Iniciar Carga'}
              </button>
            </>
          ) : (
            <button onClick={onClose} className="btn btn-primary">
              Fechar Painel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
