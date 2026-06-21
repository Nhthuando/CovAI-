import fs from 'fs';
import path from 'path';

export function getAllSourceFiles(dirPath, arrayOfFiles = []) {
    if (!fs.existsSync(dirPath)) return arrayOfFiles;

    const files = fs.readdirSync(dirPath);

    files.forEach(function (file) {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            // Bỏ qua node_modules nếu có
            if (file !== 'node_modules') {
                arrayOfFiles = getAllSourceFiles(fullPath, arrayOfFiles);
            }
        } else {
            if (file.match(/\.(js|ts|jsx|tsx)$/)) {
                arrayOfFiles.push(fullPath);
            }
        }
    });

    return arrayOfFiles;
}