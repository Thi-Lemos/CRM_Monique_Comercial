import React, { useRef } from 'react';

/**
 * CurrencyInput — campo de entrada com máscara de moeda BRL automática.
 *
 * O usuário digita apenas dígitos. O componente formata em tempo real:
 *   1234  →  R$ 12,34
 *   150000 →  R$ 1.500,00
 *
 * Props:
 *   value       – valor numérico controlado pelo pai
 *   onChange    – recebe o valor numérico (float) atualizado
 *   className   – classes CSS adicionais
 *   style       – estilos inline adicionais
 *   placeholder – placeholder do input (default: "R$ 0,00")
 *   disabled    – desabilita o campo
 *   id / name   – atributos HTML padrão
 */
interface CurrencyInputProps {
  value: number | null | undefined;
  onChange: (val: number) => void;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
}

// Converte número para string formatada sem o símbolo R$ (usado internamente)
function formatAsCurrency(val: number): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
}

export default function CurrencyInput({
  value,
  onChange,
  className = 'form-input',
  style,
  placeholder = 'R$ 0,00',
  disabled,
  id,
  name
}: CurrencyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Converte o valor numérico para a string formatada exibida no campo
  const displayValue = (value != null && value !== 0)
    ? `R$ ${formatAsCurrency(value)}`
    : '';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Permite: backspace, delete, tab, escape, setas, home, end
    const allowed = ['Backspace', 'Delete', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (allowed.includes(e.key)) return;
    // Bloqueia qualquer tecla que não seja dígito
    if (!/^\d$/.test(e.key)) {
      e.preventDefault();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Extrai apenas os dígitos do valor atual exibido
    const raw = e.target.value.replace(/\D/g, '');
    if (raw === '' || raw === '0') {
      onChange(0);
      return;
    }
    // Os últimos 2 dígitos são centavos
    const numericValue = parseInt(raw, 10) / 100;
    onChange(numericValue);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      id={id}
      name={name}
      className={className}
      style={style}
      placeholder={placeholder}
      disabled={disabled}
      value={displayValue}
      onKeyDown={handleKeyDown}
      onChange={handleInput}
    />
  );
}
