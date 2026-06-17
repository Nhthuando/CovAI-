import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { oAuthGithubApi } from "../services/auth.service";
import { Loader2 } from "lucide-react";

export default function GithubCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error === "access_denied") {
      alert("Bạn đã từ chối cấp quyền truy cập GitHub.");
      navigate("/login");
      return;
    }

    if (code) {
      // Clear the code from the URL for better UX and preventing shoulder-surfing
      window.history.replaceState({}, document.title, "/auth/github/callback");

      oAuthGithubApi(code)
        .then((data) => {
          localStorage.setItem("token", data.token);
          localStorage.setItem("userName", data.name);
          localStorage.setItem("userEmail", data.email);
          navigate("/dashboard");
        })
        .catch((err) => {
          alert("Lỗi đăng nhập GitHub: " + err.message);
          navigate("/login");
        });
    } else {
      navigate("/login");
    }
  }, [searchParams, navigate]);

  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0D1117", color: "#f0f6fc", flexDirection: "column", gap: "16px" }}>
      <Loader2 size={32} className="animate-spin" color="#7c3aed" />
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "16px", fontWeight: "500" }}>Logging in...</span>
    </div>
  );
}
