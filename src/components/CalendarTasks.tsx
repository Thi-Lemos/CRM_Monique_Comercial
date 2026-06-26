import { useEffect, useState } from 'react';
import { dataService } from '../services/dataService';
import { TaskItem, Parceiro } from '../types';
import { Calendar as CalendarIcon, CheckCircle2, ChevronRight, Trash2 } from 'lucide-react';

interface CalendarTasksProps {
  onStartInteraction: (partnerId: string) => void;
}

export default function CalendarTasks({ onStartInteraction }: CalendarTasksProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'pending' | 'overdue'>('pending');

  const loadTasksData = async () => {
    try {
      setLoading(true);
      const list = await dataService.getTasks();
      const pList = await dataService.getParceiros();
      setTasks(list);
      setParceiros(pList);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasksData();
  }, []);

  const handleToggleDone = (taskId: string) => {
    setTasks(prev => 
      prev.map(t => t.id === taskId ? { ...t, done: !t.done } : t)
    );
  };

  const handleDeleteTask = async (taskId: string) => {
    if (window.confirm('Tem certeza de que deseja apagar esta tarefa agendada?')) {
      try {
        await dataService.deleteTask(taskId);
        setTasks(prev => prev.filter(t => t.id !== taskId));
      } catch (err) {
        alert('Erro ao apagar tarefa.');
      }
    }
  };

  const getTaskStatus = (taskDate: string) => {
    const todayStr = new Date().toISOString().substring(0, 10);
    if (taskDate < todayStr) return 'atrasada';
    if (taskDate === todayStr) return 'hoje';
    return 'futura';
  };

  const filteredTasks = tasks.filter(t => {
    const status = getTaskStatus(t.date);
    if (filterType === 'pending') return !t.done;
    if (filterType === 'overdue') return !t.done && status === 'atrasada';
    return true;
  });

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--secondary-color)' }}>
          Calendário & Cadências de Contato
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
          Monitore prazos de retorno e tarefas agendadas por parceiro comercial
        </p>
      </div>

      {/* Estatísticas Rápidas da Agenda */}
      <div className="dashboard-summary-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid var(--danger)' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>TAREFAS ATRASADAS</span>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--danger)', margin: '0.15rem 0' }}>
            {tasks.filter(t => !t.done && getTaskStatus(t.date) === 'atrasada').length}
          </div>
        </div>
        <div className="card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid var(--warning)' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>COMPROMISSOS HOJE</span>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--warning)', margin: '0.15rem 0' }}>
            {tasks.filter(t => !t.done && getTaskStatus(t.date) === 'hoje').length}
          </div>
        </div>
        <div className="card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid var(--success)' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>TAREFAS AGENDADAS</span>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--success)', margin: '0.15rem 0' }}>
            {tasks.filter(t => !t.done).length}
          </div>
        </div>
      </div>

      {/* Filtros da Agenda */}
      <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '0.75rem' }}>
        <button 
          className={`btn ${filterType === 'pending' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFilterType('pending')}
          style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}
        >
          Compromissos Pendentes
        </button>
        <button 
          className={`btn ${filterType === 'overdue' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFilterType('overdue')}
          style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', color: filterType === 'overdue' ? 'white' : 'var(--danger)' }}
        >
          Apenas Atrasadas
        </button>
        <button 
          className={`btn ${filterType === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFilterType('all')}
          style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}
        >
          Todas as Tarefas
        </button>
      </div>

      {/* Lista de Tarefas */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', fontSize: '1.1rem', fontWeight: 550 }}>Carregando agenda...</div>
      ) : filteredTasks.length === 0 ? (
        <div className="card" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Nenhum compromisso pendente nesta lista!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredTasks.map(t => {
            const taskStatus = getTaskStatus(t.date);
            const partner = parceiros.find(p => p.id === t.parceiro_id);
            const dateObj = new Date(t.date + 'T12:00:00');
            const displayDate = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

            return (
              <div 
                key={t.id} 
                className="card fade-in"
                style={{ 
                  padding: '1.25rem', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  borderLeft: `4px solid ${
                    t.done ? '#cbd5e1' : 
                    taskStatus === 'atrasada' ? 'var(--danger)' : 
                    taskStatus === 'hoje' ? 'var(--warning)' : 
                    'var(--success)'
                  }`,
                  opacity: t.done ? 0.7 : 1
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, minWidth: '280px' }}>
                  <button 
                    onClick={() => handleToggleDone(t.id)}
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      cursor: 'pointer',
                      color: t.done ? 'var(--success)' : 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <CheckCircle2 size={24} style={{ color: t.done ? 'var(--success)' : '#e2e8f0', fill: t.done ? '#ecfdf5' : 'none' }} />
                  </button>
                  
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 750, color: 'var(--secondary-color)', fontSize: '0.95rem' }}>
                        {t.parceiro_nome}
                      </span>
                      {partner && (
                        <span className={`badge ${
                          partner.classificacao === 'Estratégico' ? 'badge-success' : 
                          partner.classificacao === 'Crescimento' ? 'badge-info' : 'badge-warning'
                        }`} style={{ fontSize: '0.6rem', padding: '0.1rem 0.4rem' }}>
                          {partner.classificacao}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-main)', marginTop: '0.25rem', fontWeight: 500 }}>
                      Tarefa: <strong>{t.title}</strong>
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                  {/* Data de Retorno */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600, color: taskStatus === 'atrasada' && !t.done ? 'var(--danger)' : 'var(--text-muted)' }}>
                    <CalendarIcon size={16} />
                    <span>{displayDate}</span>
                    {taskStatus === 'atrasada' && !t.done && (
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>(Atrasado)</span>
                    )}
                    {taskStatus === 'hoje' && !t.done && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--warning)', fontWeight: 700, textTransform: 'uppercase' }}>(Hoje)</span>
                    )}
                  </div>

                  {/* Botão de Atalho para Executar Contato */}
                  {!t.done && (
                    <button 
                      className="btn btn-primary"
                      onClick={() => onStartInteraction(t.parceiro_id)}
                      style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}
                    >
                      Realizar Contato <ChevronRight size={14} />
                    </button>
                  )}

                  {/* Botão de Apagar Tarefa */}
                  <button 
                    onClick={() => handleDeleteTask(t.id)}
                    className="btn btn-secondary btn-icon"
                    title="Apagar compromisso"
                    style={{ 
                      padding: '0.5rem', 
                      borderRadius: 'var(--radius-sm)', 
                      color: 'var(--danger)', 
                      borderColor: 'rgba(239, 68, 68, 0.2)',
                      backgroundColor: 'rgba(239, 68, 68, 0.05)'
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
