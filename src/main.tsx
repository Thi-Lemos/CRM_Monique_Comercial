import { useEffect, useState, StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { dataService } from './services/dataService';
import Login from './components/Login';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import PartnersList from './components/PartnersList';
import PartnerDetail from './components/PartnerDetail';
import InteractionForm from './components/InteractionForm';
import CalendarTasks from './components/CalendarTasks';
import CriteriaConfig from './components/CriteriaConfig';
import WorkRoutine from './components/WorkRoutine';
import './index.css';

function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);

  // Estado dos filtros da Carteira de Parceiros elevado para o App
  // para que não seja resetado ao abrir a ficha de um parceiro e voltar.
  const [partnersSearch, setPartnersSearch] = useState('');
  const [partnersStatusFilter, setPartnersStatusFilter] = useState('');
  const [partnersClassFilter, setPartnersClassFilter] = useState('');
  const [partnersAscendingOrder, setPartnersAscendingOrder] = useState(false);

  useEffect(() => {
    async function checkUser() {
      try {
        const currentUser = await dataService.getCurrentUser();
        setUser(currentUser);

        // Verificar parceiros Onboarding que ultrapassaram a janela sem produção.
        // Executado na abertura do sistema, independente de importação de planilha.
        if (currentUser) {
          dataService.checkAndInactivateOnboarding().catch(err =>
            console.warn('Falha na verificação de Onboarding:', err)
          );
        }
      } catch (e) {
        console.error('Erro ao buscar usuário atual:', e);
      } finally {
        setLoading(false);
      }
    }
    checkUser();
  }, []);

  const handleLogout = async () => {
    await dataService.signOut();
    setUser(null);
    setActiveTab('dashboard');
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--bg-color)',
        fontSize: '1.2rem',
        fontWeight: 600
      }}>
        Iniciando CRM Prata Digital...
      </div>
    );
  }

  // Se não estiver logado, exibe a tela de login
  if (!user) {
    return <Login onLoginSuccess={(u) => setUser(u)} />;
  }

  // Seletor de Telas
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <Dashboard 
            onSelectPartner={(id) => {
              setSelectedPartnerId(id);
              setActiveTab('parceiro-detalhe');
            }}
          />
        );
      
      case 'parceiros':
        return (
          <PartnersList 
            onSelectPartner={(id) => {
              setSelectedPartnerId(id);
              setActiveTab('parceiro-detalhe');
            }}
            search={partnersSearch}
            setSearch={setPartnersSearch}
            statusFilter={partnersStatusFilter}
            setStatusFilter={setPartnersStatusFilter}
            classFilter={partnersClassFilter}
            setClassFilter={setPartnersClassFilter}
            ascendingOrder={partnersAscendingOrder}
            setAscendingOrder={setPartnersAscendingOrder}
          />
        );
      
      case 'parceiro-detalhe':
        return selectedPartnerId ? (
          <PartnerDetail 
            partnerId={selectedPartnerId}
            onBack={() => {
              setSelectedPartnerId(null);
              setActiveTab('parceiros');
            }}
            onNewLog={(id) => {
              setSelectedPartnerId(id);
              setActiveTab('crm-form');
            }}
          />
        ) : (
          <div className="card">Nenhum parceiro selecionado.</div>
        );
      
      case 'rotina':
        return <WorkRoutine />;
      
      case 'criterios':
        return <CriteriaConfig />;

      case 'crm-form':
        return (
          <InteractionForm 
            initialPartnerId={selectedPartnerId || undefined}
            onSave={() => {
              setActiveTab('parceiro-detalhe');
            }}
            onCancel={() => {
              setActiveTab('parceiro-detalhe');
            }}
          />
        );

      case 'calendario':
        return (
          <CalendarTasks 
            onStartInteraction={(id) => {
              setSelectedPartnerId(id);
              setActiveTab('crm-form');
            }}
          />
        );
      
      default:
        return <Dashboard />;
    }
  };

  return (
    <Layout 
      activeTab={activeTab} 
      setActiveTab={(tab) => {
        // Reseta dados auxiliares ao mudar de aba principal
        if (tab !== 'parceiro-detalhe' && tab !== 'crm-form') {
          setSelectedPartnerId(null);
        }
        setActiveTab(tab);
      }} 
      onLogout={handleLogout}
      userEmail={user.email}
    >
      {renderContent()}
    </Layout>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
