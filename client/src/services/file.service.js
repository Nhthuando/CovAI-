import { API_BASE, authAwareFetch, getAccessToken } from "../lib/authSession.js";

const FILE_API_BASE = `${API_BASE}/file-manager`;

const getHeaders = () => {
    const token = getAccessToken();
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
};

export const getFileTree = async (rootDir) => {
    const response = await authAwareFetch(fetch, `${FILE_API_BASE}/tree?rootDir=${encodeURIComponent(rootDir)}`, {
        headers: getHeaders()
    });
    return response.json();
};

export const readFile = async (filePath) => {
    const response = await authAwareFetch(fetch, `${FILE_API_BASE}/read`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ filePath }),
    });
    return response.text();
};

export const saveFile = async (filePath, content) => {
    const response = await authAwareFetch(fetch, `${FILE_API_BASE}/save`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ filePath, content }),
    });
    return response.json();
};

export const deleteFile = async (filePath) => {
    const response = await authAwareFetch(fetch, `${FILE_API_BASE}/delete`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ filePath }),
    });
    return response.json();
};
