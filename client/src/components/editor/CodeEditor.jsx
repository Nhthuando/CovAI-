import React from 'react';
import Editor from '@monaco-editor/react';

const CodeEditor = ({ code, onChange, language }) => {
    return (
        <Editor
            height="100%"
            language={language || 'javascript'}
            value={code}
            onChange={onChange}
            theme="vs-dark"
            options={{
                fontSize: 14,
                minimap: { enabled: false },
            }}
        />
    );
};

export default CodeEditor;