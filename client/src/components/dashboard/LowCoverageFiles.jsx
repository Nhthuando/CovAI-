export default function LowCoverageFiles({ data }) {
    const getBadgeColor = (pct) => {
        if (pct < 50) return "bg-red-500/20 text-red-400 border-red-500/50";
        if (pct < 80) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/50";
        return "bg-green-500/20 text-green-400 border-green-500/50";
    };

    return (
        <div className="rounded-xl border bg-[#161b22] border-[#30363d] p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Low Coverage Files</h3>
            <div className="space-y-3">
                {data?.map((file, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-[#0d1117] border border-[#30363d]">
                        <span className="font-mono text-sm text-white truncate max-w-[200px]">{file.filePath}</span>
                        <span className={`px-2 py-1 rounded text-xs font-medium border ${getBadgeColor(file.coverage)}`}>
                            {file.coverage}%
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}