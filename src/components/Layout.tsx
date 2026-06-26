import { useState } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  Calendar, 
  Sliders, 
  LogOut, 
  Sparkles,
  Cloud,
  CloudOff,
  ClipboardList,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { dataService } from '../services/dataService';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  userEmail?: string;
}

export default function Layout({ children, activeTab, setActiveTab, onLogout, userEmail }: LayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const isSupabase = dataService.isSupabaseEnabled();

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { id: 'parceiros', label: 'Parceiros', icon: <Users size={20} /> },
    { id: 'rotina', label: 'Rotina de Trabalho', icon: <ClipboardList size={20} /> },
    { id: 'calendario', label: 'Calendário & Tarefas', icon: <Calendar size={20} /> },
    { id: 'criterios', label: 'Critérios & Metas', icon: <Sliders size={20} /> }
  ];

  return (
    <div className="app-container">
      {/* Sidebar Barra Lateral */}
      <aside style={{
        width: isCollapsed ? '80px' : '260px',
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'sticky',
        top: 0,
        transition: 'width 0.3s ease'
      }}>
        {/* Header Logo */}
        <div style={{
          padding: isCollapsed ? '1rem 0.5rem' : '1.5rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: isCollapsed ? 'column' : 'row',
          alignItems: 'center',
          gap: '0.75rem',
          justifyContent: isCollapsed ? 'center' : 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.5rem',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'rgba(15, 184, 130, 0.15)',
              color: 'var(--primary-color)',
              flexShrink: 0
            }}>
              <Sparkles size={20} />
            </div>
            {!isCollapsed && (
              <div>
                <h1 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--secondary-color)', lineHeight: 1.2 }}>
                  Prata Digital
                </h1>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                  CRM Comercial v1.0
                </span>
              </div>
            )}
          </div>
          
          {/* Botão de Toggle */}
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "Expandir menu" : "Recolher menu"}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--border-color)',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              marginTop: isCollapsed ? '0.5rem' : '0',
              transition: 'var(--transition)',
              flexShrink: 0
            }}
          >
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Menu de Navegação */}
        <nav style={{ flex: 1, padding: isCollapsed ? '1rem 0.5rem' : '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {menuItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                title={isCollapsed ? item.label : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isCollapsed ? 'center' : 'flex-start',
                  gap: isCollapsed ? '0' : '0.85rem',
                  width: '100%',
                  padding: isCollapsed ? '0.75rem 0' : '0.75rem 1rem',
                  fontSize: '0.9rem',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? 'var(--primary-color)' : 'var(--text-muted)',
                  backgroundColor: isActive ? 'rgba(15, 184, 130, 0.12)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'var(--transition)'
                }}
              >
                {item.icon}
                {!isCollapsed && item.label}
              </button>
            );
          })}
        </nav>

        {/* Status de Conectividade e Rodapé */}
        <div style={{
          padding: isCollapsed ? '1rem 0.5rem' : '1rem 1.5rem',
          borderTop: '1px solid var(--border-color)',
          backgroundColor: 'rgba(7, 12, 20, 0.45)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: isCollapsed ? 'center' : 'stretch',
          gap: '0.75rem'
        }}>
          {/* Conexão */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: isCollapsed ? 'center' : 'flex-start',
            gap: '0.5rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            fontWeight: 500
          }}>
            {isSupabase ? (
              <>
                <Cloud size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                {!isCollapsed && <span>Supabase Conectado</span>}
              </>
            ) : (
              <>
                <CloudOff size={14} style={{ color: 'var(--info)', flexShrink: 0 }} />
                {!isCollapsed && <span>Banco de Dados Local</span>}
              </>
            )}
          </div>

          {/* Monique info */}
          <div style={{ 
            display: 'flex', 
            flexDirection: isCollapsed ? 'column' : 'row', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            gap: isCollapsed ? '0.5rem' : '0'
          }}>
            {!isCollapsed && (
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }}>
                <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--secondary-color)' }}>
                  Monique
                </p>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden' }}>
                  {userEmail || 'monique@prata.com'}
                </p>
              </div>
            )}
            
            <button 
              onClick={onLogout}
              className="btn btn-secondary btn-icon"
              title="Sair do CRM"
              style={{ padding: '0.375rem', borderRadius: 'var(--radius-sm)', flexShrink: 0 }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
