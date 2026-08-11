import fs from 'fs';
import path from 'path';
import { ServiceError } from '../utils/serviceError.js';

export const getFileTree = async (req, res) => {
    const { rootDir } = req.query;
    if (!rootDir) throw new ServiceError("Missing rootDir", 400);

    const walk = (dir) => {
        const files = fs.readdirSync(dir);
        return files.map(file => {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            return {
                name: file,
                path: fullPath,
                isDirectory: stat.isDirectory(),
                children: stat.isDirectory() ? walk(fullPath) : null
            };
        });
    };
    res.json(walk(rootDir));
};

export const readFile = async (req, res) => {
    const { filePath } = req.body;
    if (!fs.existsSync(filePath)) throw new ServiceError("File not found", 404);
    res.send(fs.readFileSync(filePath, 'utf-8'));
};

export const saveFile = async (req, res) => {
    const { filePath, content } = req.body;
    if (!filePath || !fs.existsSync(filePath)) throw new ServiceError("Invalid file path", 400);

    try {
        fs.writeFileSync(filePath, content, 'utf-8');
        res.json({ message: "Saved" });
    } catch (error) {
        throw new ServiceError("Failed to save file", 500);
    }
};

export const deleteFile = async (req, res) => {
    const { filePath } = req.body;
    if (fs.lstatSync(filePath).isDirectory()) {
        fs.rmSync(filePath, { recursive: true });
    } else {
        fs.unlinkSync(filePath);
    }
    res.json({ message: "Deleted" });
};