export const resetPasswordEmailHtml = (name, resetUrl) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
</style>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:'Inter', sans-serif, Arial;">
<table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:60px 20px;">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#161b22;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);box-shadow:0 24px 48px rgba(0,0,0,0.4);">
        
        <!-- Header -->
        <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05);">
        <span style="font-size:24px;font-weight:800;color:#f0f6fc;letter-spacing:-0.03em;">
            TestCov<span style="color:#06B6D4;">AI</span>
        </span>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:40px 40px 20px;">
        <p style="font-size:22px;font-weight:700;color:#f0f6fc;margin:0 0 16px;">Đặt lại mật khẩu</p>
        <p style="font-size:15px;color:#8b949e;margin:0 0 24px;line-height:1.6;">
            Xin chào <strong style="color:#c9d1d9;">${name}</strong>,<br><br>
            Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản TestCovAI của bạn. 
            Nhấn vào nút bên dưới để tiến hành đổi mật khẩu mới.
        </p>

        <!-- Button -->
        <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:16px 0 32px;">
            <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg, #7C3AED 0%, #06B6D4 100%);background-color:#7C3AED;color:#ffffff;font-size:15px;font-weight:600;padding:14px 36px;border-radius:10px;text-decoration:none;box-shadow:0 8px 16px rgba(124,58,237,0.3);">
                Đặt lại mật khẩu
            </a>
            </td></tr>
        </table>

        <!-- Fallback URL -->
        <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:16px;">
            <p style="font-size:13px;color:#8b949e;margin:0 0 8px;">Hoặc sao chép đường dẫn này vào trình duyệt:</p>
            <p style="font-size:13px;color:#7C3AED;word-break:break-all;margin:0;font-family:monospace;line-height:1.5;">${resetUrl}</p>
            </td></tr>
        </table>

        <!-- Warning -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
            <tr><td style="padding-top:24px;border-top:1px solid rgba(255,255,255,0.05);">
            <p style="font-size:13px;color:#6e7681;line-height:1.6;margin:0;">
                Link này sẽ hết hạn sau <strong style="color:#8b949e;">1 phút</strong>. 
                Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này — tài khoản của bạn vẫn an toàn.
            </p>
            </td></tr>
        </table>  
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:rgba(255,255,255,0.02);padding:24px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.05);">
        <p style="font-size:12px;color:#6e7681;margin:0;">
            © 2026 TestCovAI · Hệ thống quản lý Test Coverage thông minh.
        </p>
        </td></tr>

    </table>
    </td></tr>
</table>
</body>
</html>
`;