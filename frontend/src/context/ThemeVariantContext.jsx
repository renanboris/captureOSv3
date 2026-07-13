/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';

const ThemeVariantContext = createContext({
  variant: 'classic',
  toggleVariant: () => {},
  setVariant: () => {}
});

export function ThemeVariantProvider({ children }) {
  const [variant, setVariantState] = useState(() => {
    const saved = localStorage.getItem('design_variant');
    return saved === 'purist' ? 'purist' : 'classic';
  });

  const toggleVariant = () => {
    setVariantState(prev => (prev === 'classic' ? 'purist' : 'classic'));
  };

  const setVariant = (v) => {
    if (v === 'classic' || v === 'purist') {
      setVariantState(v);
    }
  };

  useEffect(() => {
    localStorage.setItem('design_variant', variant);
  }, [variant]);

  return (
    <ThemeVariantContext.Provider value={{ variant, toggleVariant, setVariant }}>
      {children}
    </ThemeVariantContext.Provider>
  );
}

export function useThemeVariant() {
  return useContext(ThemeVariantContext);
}
