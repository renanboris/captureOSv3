import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ModalPortal({ children, isOpen, onClose }) {
  const [scrollPosition, setScrollPosition] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 600;
      setScrollPosition(scrollY);
      setViewportHeight(vh);
    };

    updatePosition();

    window.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition, { passive: true });

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Em iframes com altura expandida, se document.body for maior que a janela visível
  const isIframeExpanded = document.documentElement.scrollHeight > (window.innerHeight + 100);

  const containerStyle = isIframeExpanded
    ? {
        position: 'absolute',
        top: `${scrollPosition + viewportHeight * 0.15}px`,
        left: 0,
        right: 0,
        minHeight: `${viewportHeight * 0.7}px`,
        zIndex: 9999,
      }
    : {
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
      };

  return createPortal(
    <div className="modal-portal-wrapper">
      {/* Background Overlay */}
      <div 
        onClick={onClose}
        style={{
          position: isIframeExpanded ? 'fixed' : 'fixed',
          inset: 0,
          backgroundColor: 'rgba(2, 6, 23, 0.75)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 9998
        }}
      />
      {/* Centered Content Container */}
      <div 
        style={containerStyle}
        className="flex items-center justify-center p-4 select-none pointer-events-auto"
      >
        <div style={{ zIndex: 9999 }} className="w-full max-w-2xl flex justify-center">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
