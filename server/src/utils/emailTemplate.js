    export const resetPasswordEmailHtml = (name, resetUrl) => `
    <!DOCTYPE html>
    <html>
    <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    </head>
    <body style="margin:0;padding:0;background:#f5f5f5;font-family:sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:40px 16px;">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
            
            <!-- Header -->
            <tr><td style="background:#1a1a2e;padding:28px;text-align:center;">
            <span style="font-size:13px;font-weight:600;color:#a78bfa;letter-spacing:0.08em;text-transform:uppercase;">CovAI</span>
            </td></tr>

            <!-- Body -->
            <tr><td style="padding:32px 40px;">
            <p style="font-size:22px;font-weight:600;color:#111;margin:0 0 8px;">Đặt lại mật khẩu</p>
            <p style="font-size:14px;color:#555;margin:0 0 20px;">Xin chào <strong style="color:#111;">${name}</strong>,</p>
            <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 24px;">
                Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. 
                Nhấn vào nút bên dưới để tiến hành.
            </p>

            <!-- Button -->
            <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td align="center" style="padding:8px 0 24px;">
                <a href="${resetUrl}" style="display:inline-block;background:#1a1a2e;color:#a78bfa;font-size:14px;font-weight:600;padding:12px 32px;border-radius:8px;text-decoration:none;">
                    Đặt lại mật khẩu
                </a>
                </td></tr>
            </table>

            <!-- Fallback URL -->
            <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="background:#f8f8f8;border-radius:8px;padding:14px 18px;">
                <p style="font-size:12px;color:#888;margin:0 0 4px;">Hoặc sao chép đường dẫn này vào trình duyệt:</p>
                <p style="font-size:12px;color:#aaa;word-break:break-all;margin:0;font-family:monospace;">${resetUrl}</p>
                </td></tr>
            </table>

            <!-- Warning -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #eee;">
                <tr><td style="padding-top:20px;">
                <p style="font-size:12px;color:#aaa;line-height:1.6;margin:0;">
                    Link này sẽ hết hạn sau <strong style="color:#888;">10 phút</strong>. 
                    Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này — tài khoản của bạn vẫn an toàn.
                </p>
                </td></tr>
            </table>
            </td></tr>

            <!-- Footer -->
            <tr><td style="background:#f8f8f8;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
            <p style="font-size:12px;color:#bbb;margin:0;">© 2025 CovAI · Chính sách bảo mật</p>
            </td></tr>

        </table>
        </td></tr>
    </table>
    </body>
    </html>
    `;