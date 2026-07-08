import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { dataService } from '../services/dataService';
import { Upload, X, CheckCircle2, RefreshCw, Layers, AlertTriangle } from 'lucide-react';
import WeekSelector from './WeekSelector';
import { getLastCompletedWeek, WeekInfo } from '../utils/weekUtils';

interface ExcelImporterProps {
  onClose: () => void;
  onImportSuccess: () => void;
}

interface LogEntry {
  type: 'info' | 'success' | 'error' | 'skip';
  message: string;
}

export default function ExcelImporter({ onClose, onImportSuccess }: ExcelImporterProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<WeekInfo>(getLastCompletedWeek());
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState<{
    totalRows: number;
    processed: number;
    skipped: number;
    errors: number;
    totalVol: number;
    cnpjsNaoCadastrados: string[];
    ativacoes: number;
    reativacoes: number;
  } | null>(null);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

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
      addLog('info', `Semana de referência: ${selectedWeek.label} (${selectedWeek.inicio} → ${selectedWeek.fim})`);
      addLog('info', 'Iniciando leitura do arquivo...');

      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawRows = XLSX.utils.sheet_to_json<any>(worksheet);

          if (rawRows.length === 0) {
            addLog('error', 'A planilha selecionada está vazia.');
            setLoading(false);
            return;
          }

          addLog('info', `Planilha lida: ${rawRows.length} linha(s) encontrada(s).`);
          setProgress(15);

          const parceiros = await dataService.getParceiros();
          let processedCount = 0;
          let skippedCount = 0;
          let errorCount = 0;
          let totalVolumeAcumulado = 0;
          const cnpjsNaoCadastrados: string[] = [];

          setProgress(25);

          for (let i = 0; i < rawRows.length; i++) {
            const row = rawRows[i];
            // CNPJ é o único campo obrigatório da planilha.
            // ano/mes NÃO são lidos da planilha — vêm exclusivamente do WeekSelector.
            const cnpjRaw = String(row.cnpj || row.CNPJ || '').trim();

            // Fallback por nome quando CNPJ está ausente na planilha
            let parceiro: (typeof parceiros)[0] | undefined;
            if (!cnpjRaw) {
              const nomeRaw = String(row.promotora || row.Promotora || row.nome || row.Nome || '').trim();
              if (!nomeRaw) {
                errorCount++;
                addLog('error', `Linha ${i + 2}: CNPJ e nome ausentes — linha ignorada.`);
                continue;
              }
              const nomeNorm = nomeRaw.toLowerCase();
              parceiro = parceiros.find(p => p.nome.trim().toLowerCase() === nomeNorm);
              if (!parceiro) {
                errorCount++;
                addLog('error', `Linha ${i + 2}: CNPJ ausente e nome "${nomeRaw}" não encontrado no sistema — linha ignorada.`);
                continue;
              }
              addLog('info', `Linha ${i + 2}: CNPJ ausente — parceiro identificado pelo nome "${parceiro.nome}".`);
            } else {
              const cleanCnpj = cnpjRaw.replace(/[^\d]/g, '');
              parceiro = parceiros.find(p => (p.cnpj || '').replace(/[^\d]/g, '') === cleanCnpj);
            }

            if (!parceiro) {
              // Acumular CNPJs não cadastrados para alerta agrupado no final
              if (!cnpjsNaoCadastrados.includes(cnpjRaw)) {
                cnpjsNaoCadastrados.push(cnpjRaw);
              }
              continue;
            }

            const vol_fgts      = parseFloat(row.vol_fgts      ?? row.FGTS      ?? 0);
            const vol_clt       = parseFloat(row.vol_clt       ?? row.CLT       ?? 0);
            const vol_cgv       = parseFloat(row.vol_cgv       ?? row.CGV       ?? 0);
            const vol_pix       = parseFloat(row.vol_pix       ?? row.PIX       ?? row.Cartao ?? 0);
            const propostas_pagas = parseInt(row.propostas_pagas ?? row.propostas ?? row.Propostas ?? 0);

            try {
              const salvo = await dataService.saveProducaoSemanal({
                parceiro_id: parceiro.id,
                semana_inicio: selectedWeek.inicio,
                origem_entrada: 'planilha',
                vol_fgts,
                vol_clt,
                vol_cgv,
                vol_pix,
                propostas_pagas
              });

              const volLinha = (salvo.vol_fgts || 0) + (salvo.vol_clt || 0) + (salvo.vol_cgv || 0) + (salvo.vol_pix || 0);

              // Detectar se foi skip (manual prevaleceu) pelo vol_total idêntico ao existente
              // e origem_entrada 'manual' no salvo
              if (salvo.origem_entrada === 'manual') {
                skippedCount++;
                addLog('skip', `${parceiro.nome}: entrada manual existente mantida — planilha ignorada para esta semana.`);
              } else {
                processedCount++;
                totalVolumeAcumulado += volLinha;
                addLog('success', `${parceiro.nome}: ${selectedWeek.label} — Vol. R$ ${volLinha.toLocaleString('pt-BR')} | ${salvo.propostas_pagas} propostas`);
              }
            } catch (err: any) {
              errorCount++;
              addLog('error', `Erro ao salvar ${parceiro.nome}: ${err.message || 'Erro desconhecido'}`);
            }

            const p = Math.round(25 + ((i + 1) / rawRows.length) * 65);
            setProgress(Math.min(90, p));
          }

          setProgress(95);

          // Buscar contagem de eventos da semana para o sumário
          let ativacoes = 0;
          let reativacoes = 0;
          try {
            const eventos = await dataService.getEventosSemana(selectedWeek.inicio);
            ativacoes  = eventos.filter(e => e.tipo === 'ativacao').length;
            reativacoes = eventos.filter(e => e.tipo === 'reativacao').length;
          } catch (e) { /* silencioso */ }

          setProgress(100);
          addLog('info', 'Processamento concluído.');

          setSummary({
            totalRows: rawRows.length,
            processed: processedCount,
            skipped: skippedCount,
            errors: errorCount,
            totalVol: totalVolumeAcumulado,
            cnpjsNaoCadastrados,
            ativacoes,
            reativacoes
          });

          if (processedCount > 0) {
            onImportSuccess();
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
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      backgroundColor: 'rgba(15, 23, 42, 0.6)', display: 'flex',
      alignItems: 'flex-start', justifyContent: 'center',
      zIndex: 1000, backdropFilter: 'blur(4px)', paddingTop: '3rem', overflowY: 'auto'
    }}>
      <div className="card modal-card animate-scale" style={{
        width: '100%', maxWidth: '650px', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', padding: 0,
        boxShadow: 'var(--shadow-lg)',
        backgroundColor: 'rgba(209, 250, 237, 0.95)',
        border: '1px solid rgba(15, 184, 130, 0.35)',
        margin: '0 1rem 3rem'
      }}>
        {/* Cabeçalho */}
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--secondary-color)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Upload size={20} style={{ color: 'var(--primary-color)' }} /> Importar Planilha de Produção Semanal
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
              Carregue faturamentos da Prata Digital por parceiro. Colunas esperadas: cnpj, vol_fgts, vol_clt, vol_cgv, vol_pix, propostas_pagas.
            </p>
          </div>
          <button onClick={onClose} className="btn-close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {/* Corpo */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>

          {/* Seletor de semana — SEMPRE visível, é a fonte de verdade */}
          <div style={{ marginBottom: '1.25rem' }}>
            <WeekSelector
              value={selectedWeek}
              onChange={setSelectedWeek}
              maxCurrentWeek={false}
              label="Semana de referência da importação"
            />
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.4rem', lineHeight: 1.35 }}>
              💡 Selecione a semana civil a que se referem os dados da planilha. O ano e o mês são determinados
              pelo domingo da semana ({selectedWeek.fim} → {selectedWeek.ano}/{String(selectedWeek.mes).padStart(2,'0')}).
            </p>
          </div>

          {/* Zona de Drop */}
          {!loading && !summary && (
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              style={{
                border: '2px dashed var(--border-color)', borderRadius: 'var(--radius-sm)',
                padding: '2.5rem 1.5rem', textAlign: 'center',
                backgroundColor: file ? 'rgba(15, 184, 130, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                cursor: 'pointer', transition: 'border-color 0.2s',
                borderColor: file ? 'var(--primary-color)' : 'var(--border-color)'
              }}
              onClick={() => document.getElementById('file-upload-input')?.click()}
            >
              <input id="file-upload-input" type="file" accept=".xlsx,.xls,.csv"
                onChange={handleFileChange} style={{ display: 'none' }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  padding: '0.75rem', borderRadius: '50%',
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

          {/* Barra de Progresso */}
          {loading && (
            <div style={{ margin: '1.5rem 0', textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-main)' }}>
                <span>Processando planilha...</span>
                <span>{progress}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', borderRadius: '4px', backgroundColor: 'rgba(255, 255, 255, 0.05)', overflow: 'hidden' }}>
                <div style={{ width: `${progress}%`, height: '100%', backgroundColor: 'var(--primary-color)', transition: 'width 0.2s ease-in-out' }} />
              </div>
            </div>
          )}

          {/* Resumo pós-carga */}
          {summary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{
                padding: '1.25rem', borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                display: 'flex', alignItems: 'flex-start', gap: '1rem'
              }}>
                <CheckCircle2 size={24} style={{ color: 'var(--primary-color)', marginTop: '0.1rem', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <h4 style={{ fontWeight: 750, color: 'var(--secondary-color)', fontSize: '1rem', marginBottom: '0.6rem' }}>
                    Importação Concluída — {selectedWeek.label}
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem 1rem', fontSize: '0.85rem' }}>
                    <div><span style={{ color: 'var(--text-muted)' }}>Linhas lidas:</span> <strong>{summary.totalRows}</strong></div>
                    <div><span style={{ color: 'var(--text-muted)' }}>Registradas:</span> <strong style={{ color: 'var(--primary-color)' }}>{summary.processed}</strong></div>
                    <div><span style={{ color: 'var(--text-muted)' }}>Manual prevaleceu:</span> <strong>{summary.skipped}</strong></div>
                    <div><span style={{ color: 'var(--text-muted)' }}>Erros:</span> <strong style={{ color: summary.errors > 0 ? 'var(--danger)' : 'var(--text-main)' }}>{summary.errors}</strong></div>
                    <div><span style={{ color: 'var(--text-muted)' }}>Vol. Prata importado:</span> <strong style={{ color: 'var(--secondary-color)' }}>R$ {summary.totalVol.toLocaleString('pt-BR')}</strong></div>
                  </div>

                  {/* Transições detectadas */}
                  {(summary.ativacoes > 0 || summary.reativacoes > 0) && (
                    <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(15,184,130,0.15)', border: '1px solid rgba(15,184,130,0.3)', fontSize: '0.82rem' }}>
                      <strong>🎯 Transições detectadas esta semana:</strong>{' '}
                      {summary.ativacoes > 0 && <span>{summary.ativacoes} ativação(ões) &nbsp;</span>}
                      {summary.reativacoes > 0 && <span>{summary.reativacoes} reativação(ões)</span>}
                    </div>
                  )}
                </div>
              </div>

              {/* Alerta agrupado de CNPJs não cadastrados */}
              {summary.cnpjsNaoCadastrados.length > 0 && (
                <div style={{
                  padding: '1rem', borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.4)',
                  display: 'flex', gap: '0.75rem', alignItems: 'flex-start'
                }}>
                  <AlertTriangle size={18} style={{ color: 'var(--warning)', marginTop: '0.1rem', flexShrink: 0 }} />
                  <div>
                    <p style={{ fontWeight: 700, color: 'var(--warning)', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                      {summary.cnpjsNaoCadastrados.length} CNPJ(s) não encontrado(s) no sistema — cadastre antes de reimportar:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem', color: 'var(--text-main)', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                      {summary.cnpjsNaoCadastrados.map(cnpj => (
                        <li key={cnpj} style={{ fontFamily: 'monospace' }}>{cnpj}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Log de execução */}
          {logs.length > 0 && (
            <div style={{ marginTop: '1.25rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '0.5rem' }}>
                Histórico de Carga
              </span>
              <div style={{
                maxHeight: '180px', overflowY: 'auto',
                backgroundColor: '#0f172a', color: '#e2e8f0',
                borderRadius: 'var(--radius-sm)', padding: '0.75rem',
                fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.4,
                display: 'flex', flexDirection: 'column', gap: '0.3rem'
              }}>
                {logs.map((log, index) => (
                  <div key={index} style={{
                    color: log.type === 'success' ? '#10b981'
                         : log.type === 'error'   ? '#ef4444'
                         : log.type === 'skip'    ? '#f59e0b'
                         : '#94a3b8'
                  }}>
                    {log.type === 'success' && '✓ '}
                    {log.type === 'error'   && '✗ '}
                    {log.type === 'skip'    && '⊘ '}
                    {log.type === 'info'    && '• '}
                    {log.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div style={{
          padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)',
          backgroundColor: 'rgba(7, 12, 20, 0.45)',
          display: 'flex', justifyContent: 'flex-end', gap: '0.75rem',
          borderBottomLeftRadius: 'var(--radius-md)', borderBottomRightRadius: 'var(--radius-md)'
        }}>
          {!summary ? (
            <>
              <button onClick={onClose} disabled={loading} className="btn btn-secondary">Cancelar</button>
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
            <button onClick={onClose} className="btn btn-primary">Fechar Painel</button>
          )}
        </div>
      </div>
    </div>
  );
}
