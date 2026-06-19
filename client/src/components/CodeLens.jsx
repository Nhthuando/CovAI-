import React from 'react';

const CodeLens = ({ complexity, decisionPoints }) => {
    return (
        <span className="text-xs text-gray-500 font-mono mr-2">
            CC={complexity} • {decisionPoints} decision points
        </span>
    );
};

export default CodeLens;