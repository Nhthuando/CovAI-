import fs from "fs";

export const parseLcovFile = (filePath) => {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split('\n');
    
    const files = {};
    const total = {
        lines: { total: 0, covered: 0 },
        functions: { total: 0, covered: 0 },
        branches: { total: 0, covered: 0 }
    };
    
    let currentFile = null;
    
    lines.forEach(line => {
        if (line.startsWith('SF:')) {
            currentFile = line.substring(3).trim();
            files[currentFile] = {
                lines: { total: 0, covered: 0 },
                functions: { total: 0, covered: 0 },
                branches: { total: 0, covered: 0 }
            };
        } else if (line.startsWith('LF:')) {
            const val = parseInt(line.substring(3), 10);
            files[currentFile].lines.total = val;
            total.lines.total += val;
        } else if (line.startsWith('LH:')) {
            const val = parseInt(line.substring(3), 10);
            files[currentFile].lines.covered = val;
            total.lines.covered += val;
        } else if (line.startsWith('FNF:')) {
            const val = parseInt(line.substring(4), 10);
            files[currentFile].functions.total = val;
            total.functions.total += val;
        } else if (line.startsWith('FNH:')) {
            const val = parseInt(line.substring(4), 10);
            files[currentFile].functions.covered = val;
            total.functions.covered += val;
        } else if (line.startsWith('BRF:')) {
            const val = parseInt(line.substring(4), 10);
            files[currentFile].branches.total = val;
            total.branches.total += val;
        } else if (line.startsWith('BRH:')) {
            const val = parseInt(line.substring(4), 10);
            files[currentFile].branches.covered = val;
            total.branches.covered += val;
        }
    });

    const calculatePct = (stats) => {
        if (stats.total === 0) return 100;
        return parseFloat(((stats.covered / stats.total) * 100).toFixed(2));
    };

    total.lines.pct = calculatePct(total.lines);
    total.functions.pct = calculatePct(total.functions);
    total.branches.pct = calculatePct(total.branches);
    total.statements = { ...total.lines }; 

    for (const file in files) {
        files[file].lines.pct = calculatePct(files[file].lines);
        files[file].functions.pct = calculatePct(files[file].functions);
        files[file].branches.pct = calculatePct(files[file].branches);
        files[file].statements = { ...files[file].lines };
    }

    return { total, files };
};
