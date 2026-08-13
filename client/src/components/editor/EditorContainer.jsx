import React, { useState, useEffect } from 'react';
import * as fileService from '../../services/file.service';
import FileExplorer from './FileExplorer';
import CodeEditor from './CodeEditor';

const EditorContainer = () => { // Removed rootDir prop
    const [files, setFiles] = useState([]);
    const [currentFile, setCurrentFile] = useState(null);
    const [code, setCode] = useState('');

    useEffect(() => {
        // Pass '.' as rootDir to get files from the project root
        fileService.getFileTree('.').then(setFiles);
    }, []); // Empty dependency array means this runs once on mount

    const handleFileClick = (filePath) => {
        fileService.readFile(filePath).then(data => {
            setCurrentFile(filePath);
            setCode(data);
        });
    };

    const handleSave = () => {
        if (currentFile) { // Ensure a file is selected before saving
            fileService.saveFile(currentFile, code).then(() => {
                alert('Saved!');
            }).catch(error => {
                console.error('Failed to save file:', error);
                alert('Failed to save file. Check console for details.');
            });
        } else {
            alert('Please select a file to save.');
        }
    };

    return (
        <div style={{ display: 'flex', height: '80vh' }}>
            <div style={{ width: '250px', borderRight: '1px solid #ccc' }}>
                <FileExplorer files={files} onFileClick={handleFileClick} />
            </div>
            <div style={{ flex: 1 }}>
                {currentFile && (
                    <>
                        <button onClick={handleSave}>Save</button>
                        <CodeEditor code={code} onChange={(value) => setCode(value)} />
                    </>
                )}
            </div>
        </div>
    );
};

export default EditorContainer;
