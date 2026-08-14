import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileCode, Play } from 'lucide-react';

const TestModeSelector = ({ isOpen, onClose, onSelect }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: '#0d1117',
            border: '1px solid #7c3aed',
            borderRadius: '12px',
            padding: '16px',
            width: '240px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3), 0 0 20px rgba(124,58,237,0.2)',
          }}
        >
          <div style={{ color: '#c9d1d9', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
            Select Test Mode
          </div>
          
          <button
            onClick={() => onSelect('SKELETON')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid #30363d',
              borderRadius: '6px',
              color: '#e6edf3',
              cursor: 'pointer',
              fontSize: '13px',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(124,58,237,0.1)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
          >
            <FileCode size={14} /> Generate Skeleton
          </button>

          <button
            onClick={() => onSelect('FULL')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 12px',
              background: 'rgba(124,58,237,0.1)',
              border: '1px solid #7c3aed',
              borderRadius: '6px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '13px',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(124,58,237,0.2)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(124,58,237,0.1)'}
          >
            <Play size={14} /> Generate Full Test
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default TestModeSelector;