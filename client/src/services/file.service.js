const API_BASE = '/api/file-manager';

const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('token')}`
});

export const getFileTree = async (rootDir) => {
    const response = await fetch(`${API_BASE}/tree?rootDir=${encodeURIComponent(rootDir)}`, {
        headers: getHeaders()
    });
    return response.json();
};

export const readFile = async (filePath) => {
    const response = await fetch(`${API_BASE}/read`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ filePath }),
    });
    return response.text();
};

export const saveFile = async (filePath, content) => {
    const response = await fetch(`${API_BASE}/save`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ filePath, content }),
    });
    return response.json();
};

export const deleteFile = async (filePath) => {
    const response = await fetch(`${API_BASE}/delete`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ filePath }),
    });
    return response.json();
};
