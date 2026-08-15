import React from 'react';
import { Folder, FileText } from 'lucide-react';

const FileExplorer = ({ files, onFileClick }) => {
    const renderTree = (nodes) => {
        return nodes.map((node) => (
            <div key={node.path} style={{ marginLeft: '10px' }}>
                <div
                    onClick={() => !node.isDirectory && onFileClick(node.path)}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
                >
                    {node.isDirectory ? <Folder size={16} /> : <FileText size={16} />}
                    <span style={{ marginLeft: '5px' }}>{node.name}</span>
                </div>
                {node.isDirectory && node.children && (
                    <div>{renderTree(node.children)}</div>
                )}
            </div>
        ));
    };

    return <div>{renderTree(files)}</div>;
};

export default FileExplorer;