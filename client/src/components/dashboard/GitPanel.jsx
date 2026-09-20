import { useState } from "react";
import { gitService } from "../../services/git.service";

export const GitPanel = ({ projectId }) => {
  const [output, setOutput] = useState("");
  const runCommand = async (command, args = []) => {
    try {
      const res = await gitService.runCommand(projectId, command, args);
      setOutput(
        (prev) => prev + `\n$ git ${command} ${args.join(" ")}\n${res.result}`,
      );
    } catch (err) {
      setOutput(
        (prev) =>
          prev + `\n$ git ${command} ${args.join(" ")}\nError: ${err.message}`,
      );
    }
  };

  return (
    <div
      className="flex flex-col select-none text-[13px]"
      style={{
        background: "#21252B",
        color: "var(--text-primary)",
        height: "100%",
      }}
    >
      {/* Header - Looks like a folder */}
      <div
        className="flex items-center cursor-pointer hover:bg-white/5 py-1 px-2"
        style={{ color: "var(--text-secondary)" }}
      >
        <span style={{ marginRight: 6 }}>▼</span>
        <span
          style={{ fontWeight: 600, fontSize: "11px", letterSpacing: "0.5px" }}
        >
          GIT OPERATIONS
        </span>
      </div>

      {/* Command List - Looks like files */}
      <div className="flex flex-col pl-4">
        <div
          onClick={() => runCommand("status")}
          className="cursor-pointer hover:bg-white/5 py-1 px-2 flex items-center gap-2"
        >
          <span style={{ color: "var(--text-secondary)" }}>○</span> Status
        </div>
        <div
          onClick={() => runCommand("pull")}
          className="cursor-pointer hover:bg-white/5 py-1 px-2 flex items-center gap-2"
        >
          <span style={{ color: "var(--text-secondary)" }}>↓</span> Pull
        </div>
        <div
          onClick={() => runCommand("push")}
          className="cursor-pointer hover:bg-white/5 py-1 px-2 flex items-center gap-2"
        >
          <span style={{ color: "var(--text-secondary)" }}>↑</span> Push
        </div>
      </div>

      {/* Output - Looks like tree logs */}
      <div
        className="mt-4 pl-6 pr-2 text-[11px]"
        style={{
          color: "var(--text-secondary)",
          fontFamily: "var(--font-mono)",
          opacity: 0.7,
          whiteSpace: "pre-wrap",
        }}
      >
        {output || "// No recent activity"}
      </div>
    </div>
  );
};

export default GitPanel;
