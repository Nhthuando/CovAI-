import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

export const Toast = ({ title, message, type = 'info', duration = 5000, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, duration);
        return () => clearTimeout(timer);
    }, [duration, onClose]);

    const icons = {
        success: <CheckCircle className="text-green-400" size={20} />,
        error: <AlertCircle className="text-red-400" size={20} />,
        info: <Info className="text-blue-400" size={20} />
    };

    const bgColors = {
        success: 'bg-green-900/20 border-green-500/20',
        error: 'bg-red-900/20 border-red-500/20',
        info: 'bg-blue-900/20 border-blue-500/20'
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex items-start gap-3 p-4 rounded-lg border ${bgColors[type]} backdrop-blur-md shadow-lg min-w-[300px]`}
        >
            {icons[type]}
            <div className="flex-1">
                <h4 className="text-sm font-semibold text-white">{title}</h4>
                <p className="text-xs text-gray-400 mt-1">{message}</p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white">
                <X size={16} />
            </button>
        </motion.div>
    );
};