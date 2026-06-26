import React, { useState } from 'react';
import { dataService } from '../services/dataService';
import { KeyRound, Mail } from 'lucide-react';
import logoImg from '../assets/logo.png';

interface LoginProps {
  onLoginSuccess: (user: any) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSupabase = dataService.isSupabaseEnabled();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { user, error: authError } = await dataService.signIn(email, password);
      
      if (authError) {
        setError(authError.message);
      } else if (user) {
        onLoginSuccess(user);
      }
    } catch (err: any) {
      setError(err.message || 'Erro inesperado ao realizar o login.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: 'var(--bg-color)',
      padding: '1rem'
    }}>
      <div className="card fade-in" style={{
        width: '100%',
        maxWidth: '420px',
        padding: '2.5rem 2rem',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)'
      }}>
        {/* Logo/Marca */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img 
            src={logoImg} 
            alt="Logo Prata Digital" 
            style={{
              maxWidth: '220px',
              height: 'auto',
              marginBottom: '1rem'
            }}
          />
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            CRM Comercial · Monique
          </p>
        </div>

        {/* Mensagem de Erro */}
        {error && (
          <div style={{
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--danger-bg)',
            color: 'var(--danger)',
            fontSize: '0.85rem',
            fontWeight: 500,
            marginBottom: '1.5rem',
            border: '1px solid #fecaca'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">
              E-mail Comercial
            </label>
            <div style={{ position: 'relative' }}>
              <Mail size={18} style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)'
              }} />
              <input
                id="email"
                type="email"
                required
                className="form-input"
                style={{ paddingLeft: '40px' }}
                placeholder="exemplo@pratadigital.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '2rem' }}>
            <label className="form-label" htmlFor="password">
              Senha de Acesso
            </label>
            <div style={{ position: 'relative' }}>
              <KeyRound size={18} style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)'
              }} />
              <input
                id="password"
                type="password"
                required
                className="form-input"
                style={{ paddingLeft: '40px' }}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.8rem', fontSize: '0.95rem' }}
            disabled={loading}
          >
            {loading ? 'Autenticando...' : 'Entrar no Sistema'}
          </button>
        </form>

        {!isSupabase && (
          <div style={{
            marginTop: '1.5rem',
            textAlign: 'center',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            lineHeight: 1.4
          }}>
            Para testar em modo local offline use:<br />
            <strong>monique@pratadigital.com.br</strong> / <strong>prata123</strong>
          </div>
        )}
      </div>
    </div>
  );
}
