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
          const userPayload = {
            id: data.userId || data.id,
            name: data.name,
            email: data.email,
            token: data.token,
          };
          localStorage.setItem("token", data.token);
          localStorage.setItem("user", JSON.stringify(userPayload));
          localStorage.setItem("userName", data.name);
          localStorage.setItem("userEmail", data.email);
          navigate("/projects");
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
    <div className="h-screen flex items-center justify-center flex-col gap-4 bg-[var(--color-bg)] text-[var(--color-text)] font-sans">
      <Loader2 size={32} className="animate-spin text-[var(--color-primary)]" />
      <span className="text-sm font-medium text-[var(--color-text-secondary)]">
        Authenticating with GitHub...
      </span>
    </div>
  );
}
