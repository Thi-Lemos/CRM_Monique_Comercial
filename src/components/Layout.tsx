import { useState } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  Calendar, 
  Sliders, 
  LogOut, 
  ClipboardList,
} from 'lucide-react';
import logoImg from '../assets/logo.png';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  userEmail?: string;
}

export default function Layout({ children, activeTab, setActiveTab, onLogout, userEmail }: LayoutProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { id: 'parceiros', label: 'Parceiros', icon: <Users size={20} /> },
    { id: 'rotina', label: 'Rotina de Trabalho', icon: <ClipboardList size={20} /> },
    { id: 'calendario', label: 'Calendário & Tarefas', icon: <Calendar size={20} /> },
    { id: 'criterios', label: 'Critérios & Metas', icon: <Sliders size={20} /> }
  ];

  return (
    <div className="app-container">
      {/* Sidebar Barra Lateral — expande ao hover */}
      <aside
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
        style={{
          width: isExpanded ? '260px' : '68px',
          background: 'rgba(15, 184, 130, 0.22)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRight: '1px solid rgba(15, 184, 130, 0.4)',
          boxShadow: isExpanded ? '4px 0 24px rgba(15, 184, 130, 0.18)' : '2px 0 12px rgba(15, 184, 130, 0.10)',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          position: 'sticky',
          top: 0,
          transition: 'width 0.28s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.28s ease',
          overflow: 'hidden',
          zIndex: 50,
          flexShrink: 0
        }}
      >
        {/* Header Logo */}
        <div style={{
          padding: '1.25rem 1rem',
          borderBottom: '1px solid rgba(15, 184, 130, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '72px',
          overflow: 'hidden'
        }}>
          <img
            src={logoImg}
            alt="Logo Prata Digital"
            style={{
              width: isExpanded ? '150px' : '36px',
              height: 'auto',
              maxHeight: '44px',
              objectFit: 'contain',
              objectPosition: isExpanded ? 'left' : 'center',
              transition: 'width 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
              borderRadius: 0,
              boxShadow: 'none',
              background: 'transparent',
              flexShrink: 0
            }}
          />
        </div>

        {/* Menu de Navegação */}
        <nav style={{ flex: 1, padding: '1rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {menuItems.map((item) => {
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                title={!isExpanded ? item.label : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isExpanded ? 'flex-start' : 'center',
                  gap: '0.85rem',
                  width: '100%',
                  padding: '0.75rem 0.85rem',
                  fontSize: '0.9rem',
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? '#0fb882' : '#1a4a3a',
                  backgroundColor: isActive ? 'rgba(15, 184, 130, 0.25)' : 'transparent',
                  border: isActive ? '1px solid rgba(15, 184, 130, 0.3)' : '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.18s ease',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden'
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(15, 184, 130, 0.18)';
                    (e.currentTarget as HTMLButtonElement).style.color = '#0a2e22';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = '#1a4a3a';
                  }
                }}
              >
                <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{item.icon}</span>
                <span style={{
                  opacity: isExpanded ? 1 : 0,
                  width: isExpanded ? 'auto' : 0,
                  transition: 'opacity 0.2s ease 0.05s, width 0.28s ease',
                  overflow: 'hidden',
                  display: 'block'
                }}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Rodapé */}
        <div style={{
          padding: '0.85rem 0.5rem',
          borderTop: '1px solid rgba(15, 184, 130, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isExpanded ? 'space-between' : 'center',
          gap: '0.5rem',
          overflow: 'hidden'
        }}>
          {isExpanded && (
            <div style={{ overflow: 'hidden', opacity: isExpanded ? 1 : 0, transition: 'opacity 0.2s ease' }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                Monique
              </p>
              <p style={{ fontSize: '0.7rem', color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>
                {userEmail || 'monique@prata.com'}
              </p>
            </div>
          )}

          <button
            onClick={onLogout}
            className="btn btn-secondary btn-icon"
            title="Sair do CRM"
            style={{
              padding: '0.375rem',
              borderRadius: 'var(--radius-sm)',
              flexShrink: 0,
              color: '#172554',
              borderColor: 'rgba(15, 184, 130, 0.35)',
              backgroundColor: 'rgba(255, 255, 255, 0.7)'
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
