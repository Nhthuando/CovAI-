import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap } from 'lucide-react';

const MissingTestFilesModal = ({ isOpen, onClose, projectName, onGenerate }) => {
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
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(4px)',
                }}
            >
                <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        background: '#0d1117',
                        border: '1px solid #30363d',
                        borderRadius: '20px',
                        padding: '32px',
                        width: '480px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '20px',
                        boxShadow: '0 20px 40px -10px rgba(0,0,0,0.5), 0 0 20px rgba(124,58,237,0.1)',
                    }}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', textAlign: 'center' }}>
                        <div style={{
                            width: 64, height: 64, borderRadius: '50%',
                            background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a78bfa'
                        }}>
                            <Zap size={32} />
                        </div>
                        <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#f0f6fc' }}>Missing Test Files</h2>
                    </div>

                    <div style={{ color: '#8b949e', fontSize: '14px', lineHeight: 1.6, textAlign: 'center', padding: '0 16px' }}>
                        <p style={{ margin: '0 0 16px 0' }}>Dự án <strong style={{ color: '#c9d1d9' }}>{projectName}</strong> chưa có file test (Jest).</p>
                        <p style={{ margin: 0 }}>Quá trình phân tích Code Coverage cần có test files để chạy thành công. Bạn có muốn AI tự động sinh Test Code cho dự án <strong style={{ color: '#c9d1d9' }}>{projectName}</strong> không?</p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                        <button
                            onClick={() => onGenerate('SKELETON')}
                            style={{
                                padding: '14px',
                                background: '#7c3aed',
                                border: 'none',
                                borderRadius: '8px',
                                color: '#fff',
                                cursor: 'pointer',
                                fontSize: '15px',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                transition: 'background 0.2s',
                            }}
                            onMouseOver={(e) => e.currentTarget.style.background = '#6d28d9'}
                            onMouseOut={(e) => e.currentTarget.style.background = '#7c3aed'}
                        >
                            <Zap size={18} /> Generate Skeleton Tests
                        </button>
                        <button
                            onClick={() => onGenerate('FULL')}
                            style={{
                                padding: '14px',
                                background: 'transparent',
                                border: '1px solid #30363d',
                                borderRadius: '8px',
                                color: '#c9d1d9',
                                cursor: 'pointer',
                                fontSize: '15px',
                                fontWeight: 600,
                                transition: 'all 0.2s',
                            }}
                            onMouseOver={(e) => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.borderColor = '#8b949e'; }}
                            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#30363d'; }}
                        >
                            Generate Full Tests
                        </button>
                        <button
                            onClick={onClose}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#6e7681',
                                cursor: 'pointer',
                                fontSize: '14px',
                                padding: '8px',
                                textDecoration: 'underline',
                                marginTop: '8px',
                            }}
                        >
                            Bỏ qua
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default MissingTestFilesModal;