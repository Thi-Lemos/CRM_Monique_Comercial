import { useEffect, useState } from 'react';
import { dataService } from '../services/dataService';
import { Parceiro, CrmLog } from '../types';
import { CheckSquare, Square, Plus, Trash2, Calendar, ClipboardList, Sparkles } from 'lucide-react';

interface RoutineTask {
  id: string;
  title: string;
  dayOfWeek: 'Segunda' | 'Terça' | 'Quarta' | 'Quinta' | 'Sexta';
  done: boolean;
  isDynamic: boolean;
  parceiroId?: string;
}

export default function WorkRoutine() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<RoutineTask[]>([]);
  const [newTasksInput, setNewTasksInput] = useState<{ [key: string]: string }>({
    Segunda: '',
    Terça: '',
    Quarta: '',
    Quinta: '',
    Sexta: ''
  });

  const diasSemana: ('Segunda' | 'Terça' | 'Quarta' | 'Quinta' | 'Sexta')[] = [
    'Segunda',
    'Terça',
    'Quarta',
    'Quinta',
    'Sexta'
  ];

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const pList = await dataService.getParceiros();
        const lList = await dataService.getLogs();

        // Inicializar tarefas (sugestões dinâmicas + tarefas customizadas salvas)
        initializeTasks(pList, lList);
      } catch (e) {
        console.error('Erro ao carregar dados da rotina:', e);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const initializeTasks = (pList: Parceiro[], lList: CrmLog[]) => {
    // 1. Carregar tarefas customizadas salvas do localStorage
    const saved = localStorage.getItem('crm_prata_digital_rotina');
    let savedTasks: RoutineTask[] = saved ? JSON.parse(saved) : [];

    // Filtrar para remover tarefas dinâmicas salvas antigas (vamos regenerar elas dinamicamente e bater os estados de conclusão)
    const customSaved = savedTasks.filter(t => !t.isDynamic);
    const dynamicDoneStates = savedTasks.filter(t => t.isDynamic && t.done).map(t => t.id);

    // 2. Gerar sugestões dinâmicas baseadas na saúde da carteira
    const dynamicTasks: RoutineTask[] = [];
    const hoje = new Date();

    // SEGUNDA-FEIRA
    dynamicTasks.push({
      id: 'dyn_import_xlsx',
      title: 'Carga de Faturamento: Realizar importação da planilha semanal XLSX',
      dayOfWeek: 'Segunda',
      done: dynamicDoneStates.includes('dyn_import_xlsx'),
      isDynamic: true
    });
    dynamicTasks.push({
      id: 'dyn_rev_semaforo',
      title: 'Governança: Revisar semáforo comercial de desempenho (metas semanais)',
      dayOfWeek: 'Segunda',
      done: dynamicDoneStates.includes('dyn_rev_semaforo'),
      isDynamic: true
    });
    // Hunter novos leads
    const novosLeads = pList.filter(p => p.status === 'Em prospecção');
    novosLeads.slice(0, 3).forEach(p => {
      const id = `dyn_hunter_new_${p.id}`;
      dynamicTasks.push({
        id,
        title: `Hunter: Realizar 1º contato de qualificação com o novo lead ${p.nome}`,
        dayOfWeek: 'Segunda',
        done: dynamicDoneStates.includes(id),
        isDynamic: true,
        parceiroId: p.id
      });
    });

    // TERÇA-FEIRA
    // Farmer Estratégico sem contato há mais de 30 dias
    const estrategicosSemContato = pList.filter(p => p.classificacao === 'Estratégico' && p.status === 'Ativo');
    estrategicosSemContato.forEach(p => {
      const logsParceiro = lList.filter(l => l.parceiro_id === p.id);
      const dataUltima = logsParceiro.length > 0 ? new Date(logsParceiro[0].data_contato) : null;
      
      if (!dataUltima || (hoje.getTime() - dataUltima.getTime()) > (30 * 24 * 60 * 60 * 1000)) {
        const id = `dyn_farmer_strat_call_${p.id}`;
        dynamicTasks.push({
          id,
          title: `Farmer Estratégico: Ligar para ${p.nome} (Sem contato nos últimos 30 dias)`,
          dayOfWeek: 'Terça',
          done: dynamicDoneStates.includes(id),
          isDynamic: true,
          parceiroId: p.id
        });
      }
    });

    // Win-back: inativos pendentes de diagnóstico
    const inativosWinback = pList.filter(p => p.status === 'Inativo');
    inativosWinback.slice(0, 3).forEach(p => {
      const id = `dyn_winback_diag_${p.id}`;
      dynamicTasks.push({
        id,
        title: `Win-back: Contato diagnóstico com o inativo ${p.nome} para apurar causa real`,
        dayOfWeek: 'Terça',
        done: dynamicDoneStates.includes(id),
        isDynamic: true,
        parceiroId: p.id
      });
    });

    // QUARTA-FEIRA
    // Farmer Crescimento qualificado para cross-selling
    const crescimentoParceiros = pList.filter(p => p.classificacao === 'Crescimento' && p.status === 'Ativo');
    crescimentoParceiros.forEach(p => {
      // Regra 1: Qualificado para CGV
      if (!p.produtos_ativos.includes('CGV') && p.num_vendedores >= 4) {
        const id = `dyn_cross_cgv_${p.id}`;
        dynamicTasks.push({
          id,
          title: `Farmer Crescimento: Apresentar proposta de cross-selling do produto CGV para ${p.nome}`,
          dayOfWeek: 'Quarta',
          done: dynamicDoneStates.includes(id),
          isDynamic: true,
          parceiroId: p.id
        });
      }
      // Regra 2: Qualificado para Pix no Cartão (Digitais)
      if (!p.produtos_ativos.includes('Pix') && p.modelo_atuacao === 'Digital') {
        const id = `dyn_cross_pix_${p.id}`;
        dynamicTasks.push({
          id,
          title: `Farmer Crescimento: Apresentar Pix no Cartão como complemento digital para ${p.nome}`,
          dayOfWeek: 'Quarta',
          done: dynamicDoneStates.includes(id),
          isDynamic: true,
          parceiroId: p.id
        });
      }
    });

    // QUINTA-FEIRA
    // Onboarding Hunter travado (novos sem produção com mais de 7 dias)
    const onboardingTravado = pList.filter(p => p.status === 'Em prospecção');
    onboardingTravado.forEach(p => {
      const dataCriacao = p.created_at ? new Date(p.created_at) : hoje;
      const diasSemProd = (hoje.getTime() - dataCriacao.getTime()) / (1000 * 60 * 60 * 24);
      
      if (diasSemProd > 7 && p.vol_prata_mensal === 0) {
        const id = `dyn_hunter_onboard_support_${p.id}`;
        dynamicTasks.push({
          id,
          title: `Hunter Onboarding: Ligar para ${p.nome} e solucionar gargalos na ativação da plataforma`,
          dayOfWeek: 'Quinta',
          done: dynamicDoneStates.includes(id),
          isDynamic: true,
          parceiroId: p.id
        });
      }
    });

    // SEXTA-FEIRA
    dynamicTasks.push({
      id: 'dyn_rev_kpi',
      title: 'Métricas: Avaliar faturamento mensal consolidado por produto e KPIs no Dashboard',
      dayOfWeek: 'Sexta',
      done: dynamicDoneStates.includes('dyn_rev_kpi'),
      isDynamic: true
    });
    dynamicTasks.push({
      id: 'dyn_winback_decision',
      title: 'Decisão Win-back: Revisar inativos sem resposta por 15+ dias para inativação temporária',
      dayOfWeek: 'Sexta',
      done: dynamicDoneStates.includes('dyn_winback_decision'),
      isDynamic: true
    });

    // Juntar e ordenar: dinâmicas primeiro, customizadas depois
    setTasks([...dynamicTasks, ...customSaved]);
  };

  const persistTasks = (allTasks: RoutineTask[]) => {
    localStorage.setItem('crm_prata_digital_rotina', JSON.stringify(allTasks));
  };

  const handleToggleTask = (id: string) => {
    const updated = tasks.map(t => {
      if (t.id === id) {
        return { ...t, done: !t.done };
      }
      return t;
    });
    setTasks(updated);
    persistTasks(updated);
  };

  const handleAddTask = (day: 'Segunda' | 'Terça' | 'Quarta' | 'Quinta' | 'Sexta') => {
    const title = newTasksInput[day].trim();
    if (!title) return;

    const newTask: RoutineTask = {
      id: 'custom_' + Math.random().toString(36).substr(2, 9),
      title,
      dayOfWeek: day,
      done: false,
      isDynamic: false
    };

    const updated = [...tasks, newTask];
    setTasks(updated);
    persistTasks(updated);
    
    setNewTasksInput(prev => ({ ...prev, [day]: '' }));
  };

  const handleDeleteTask = (id: string) => {
    const updated = tasks.filter(t => t.id !== id);
    setTasks(updated);
    persistTasks(updated);
  };

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', fontSize: '1.1rem', fontWeight: 500 }}>Carregando planejamento de rotina comercial...</div>;
  }

  // Filtrar tarefas por dia
  const getTasksByDay = (day: string) => {
    return tasks.filter(t => t.dayOfWeek === day);
  };

  return (
    <div className="fade-in">
      {/* Cabeçalho */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--secondary-color)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <ClipboardList size={28} style={{ color: 'var(--primary-color)' }} /> Rotina de Trabalho Semanal
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
          Gestão de carteira interativa dia a dia. Atue em 100% da carteira com base nos alertas gerados em tempo real pelo CRM.
        </p>
      </div>

      {/* Grid de Dias da Semana */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '1.5rem',
        alignItems: 'start'
      }}>
        {diasSemana.map(day => {
          const dayTasks = getTasksByDay(day);
          const doneCount = dayTasks.filter(t => t.done).length;
          const pctDone = dayTasks.length > 0 ? Math.round((doneCount / dayTasks.length) * 100) : 0;

          return (
            <div key={day} className="card" style={{
              padding: '1.25rem',
              borderTop: '4px solid var(--primary-color)',
              minHeight: '400px',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {/* Dia Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
                borderBottom: '1px solid var(--border-color)',
                paddingBottom: '0.75rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Calendar size={18} style={{ color: 'var(--primary-color)' }} />
                  <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--secondary-color)' }}>
                    {day}-feira
                  </span>
                </div>
                <span className={`badge ${pctDone === 100 ? 'badge-success' : 'badge-info'}`} style={{ fontSize: '0.7rem' }}>
                  {pctDone === 100 ? 'Feito ✓' : `${doneCount}/${dayTasks.length}`}
                </span>
              </div>

              {/* Lista de Tarefas */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
                {dayTasks.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '2rem 0' }}>
                    Nenhuma tarefa agendada para hoje!
                  </p>
                ) : (
                  dayTasks.map(task => (
                    <div 
                      key={task.id} 
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.6rem',
                        padding: '0.6rem',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: task.done ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid var(--border-color)',
                        transition: 'all 0.2s',
                        opacity: task.done ? 0.7 : 1
                      }}
                    >
                      {/* Checkbox */}
                      <button 
                        onClick={() => handleToggleTask(task.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          color: task.done ? 'var(--primary-color)' : 'var(--text-muted)',
                          marginTop: '0.1rem'
                        }}
                      >
                        {task.done ? <CheckSquare size={18} /> : <Square size={18} />}
                      </button>

                      {/* Título da Tarefa */}
                      <div style={{ flex: 1 }}>
                        <span style={{
                          fontSize: '0.85rem',
                          fontWeight: 550,
                          color: 'var(--text-main)',
                          textDecoration: task.done ? 'line-through' : 'none',
                          lineHeight: 1.3
                        }}>
                          {task.title}
                        </span>

                        {/* Etiqueta Sugerida (Dinâmica) */}
                        {task.isDynamic && (
                          <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.2rem',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            color: 'var(--primary-color)',
                            backgroundColor: 'var(--success-bg)',
                            padding: '0.1rem 0.4rem',
                            borderRadius: '3px',
                            marginTop: '0.25rem'
                          }}>
                            <Sparkles size={10} /> Sugestão CRM
                          </div>
                        )}
                      </div>

                      {/* Excluir se for customizada */}
                      {!task.isDynamic && (
                        <button 
                          onClick={() => handleDeleteTask(task.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--danger)',
                            opacity: 0.6,
                            padding: '0 0.2rem'
                          }}
                          title="Excluir tarefa"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Adicionar Nova Tarefa */}
              <div style={{
                marginTop: 'auto',
                display: 'flex',
                gap: '0.5rem',
                borderTop: '1px solid var(--border-color)',
                paddingTop: '0.75rem'
              }}>
                <input 
                  type="text" 
                  placeholder="Nova tarefa..."
                  value={newTasksInput[day]}
                  onChange={(e) => setNewTasksInput(prev => ({ ...prev, [day]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddTask(day);
                  }}
                  style={{
                    flex: 1,
                    fontSize: '0.85rem',
                    padding: '0.4rem 0.6rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'rgba(15, 23, 42, 0.4)',
                    color: 'var(--text-main)'
                  }}
                />
                <button 
                  onClick={() => handleAddTask(day)}
                  className="btn btn-primary"
                  style={{
                    padding: '0.4rem 0.6rem',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Plus size={16} />
                </button>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}
