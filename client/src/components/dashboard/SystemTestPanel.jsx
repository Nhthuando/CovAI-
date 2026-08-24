import { useState, useEffect } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { getSystemTestFrameworks } from "../../services/systemTest.service";

export default function SystemTestPanel({ projectId, snapshotId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadFrameworks = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await getSystemTestFrameworks(projectId, snapshotId);
        setData(response.data);
      } catch (err) {
        setError(err.message || "Failed to detect system test frameworks");
      } finally {
        setLoading(false);
      }
    };

    if (projectId) {
      loadFrameworks();
    }
  }, [projectId, snapshotId]);

  if (loading) {
    return (
      <div
        style={{
          padding: "16px",
          borderRadius: "8px",
          backgroundColor: "#0d1117",
          border: "1px solid #30363d",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Loader2 size={14} className="animate-spin" />
          <span style={{ color: "#8b949e", fontSize: 12 }}>
            Detecting system test frameworks...
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: "16px",
          borderRadius: "8px",
          backgroundColor: "#0d1117",
          border: "1px solid #da3633",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <AlertCircle size={14} style={{ color: "#da3633" }} />
          <span style={{ color: "#da3633", fontSize: 12 }}>{error}</span>
        </div>
      </div>
    );
  }

  if (
    !data ||
    !data.frameworks ||
    data.frameworks.length === 0 ||
    !data.hasSystemTests
  ) {
    return (
      <div
        style={{
          padding: "16px",
          borderRadius: "8px",
          backgroundColor: "#0d1117",
          border: "1px solid #30363d",
        }}
      >
        <div style={{ marginBottom: "8px" }}>
          <span style={{ color: "#e6edf3", fontSize: 12, fontWeight: 600 }}>
            System Tests
          </span>
        </div>
        <p style={{ color: "#8b949e", fontSize: 11, lineHeight: 1.5 }}>
          No supported System Test framework detected.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "16px",
        borderRadius: "8px",
        backgroundColor: "#0d1117",
        border: "1px solid #30363d",
      }}
    >
      <div style={{ marginBottom: "12px" }}>
        <span style={{ color: "#e6edf3", fontSize: 12, fontWeight: 600 }}>
          System Tests
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {data.frameworks.map((framework) => (
          <div key={framework.name}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "6px",
              }}
            >
              <CheckCircle2 size={12} style={{ color: "#3fb950" }} />
              <span
                style={{
                  color: "#e6edf3",
                  fontSize: 12,
                  fontWeight: 500,
                  textTransform: "capitalize",
                }}
              >
                {framework.name.toLowerCase()}
              </span>
            </div>

            {framework.configPath && (
              <div style={{ marginLeft: "20px", marginBottom: "4px" }}>
                <span style={{ color: "#8b949e", fontSize: 11 }}>
                  Config:{" "}
                  <span style={{ color: "#79c0ff", fontFamily: "monospace" }}>
                    {framework.configPath}
                  </span>
                </span>
              </div>
            )}

            {framework.testDirectory && (
              <div style={{ marginLeft: "20px", marginBottom: "4px" }}>
                <span style={{ color: "#8b949e", fontSize: 11 }}>
                  Test Dir:{" "}
                  <span style={{ color: "#79c0ff", fontFamily: "monospace" }}>
                    {framework.testDirectory}
                  </span>
                </span>
              </div>
            )}

            {framework.testFileCount && framework.testFileCount > 0 && (
              <div style={{ marginLeft: "20px", marginBottom: "4px" }}>
                <span style={{ color: "#8b949e", fontSize: 11 }}>
                  Tests:{" "}
                  <span style={{ color: "#79c0ff" }}>
                    {framework.testFileCount}
                  </span>
                </span>
              </div>
            )}

            {framework.browsers && (
              <div style={{ marginLeft: "20px" }}>
                <span style={{ color: "#8b949e", fontSize: 11 }}>
                  Browsers:{" "}
                  <span style={{ color: "#79c0ff" }}>{framework.browsers}</span>
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {data.errors && data.errors.length > 0 && (
        <div
          style={{
            marginTop: "12px",
            paddingTop: "12px",
            borderTop: "1px solid #30363d",
          }}
        >
          <div style={{ color: "#f0883e", fontSize: 10, lineHeight: 1.4 }}>
            {data.errors.map((err, i) => (
              <div key={i}>• {err}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
