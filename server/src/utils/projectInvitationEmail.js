const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const roles = {
    EDITOR: { label: 'Editor', description: 'Edit project files, run tests, and work with shared AI.' },
    VIEWER: { label: 'Viewer', description: 'View project files and results, read shared AI history, and export reports.' },
};

/** Multipart email content only; delivery reuses the password-reset transport. */
export function createProjectInvitationEmail({ projectName, inviterName, role, email, invitationUrl, expiresAt }) {
    const access = roles[role];
    if (!access) throw new TypeError('Invalid invitation role');
    const url = new URL(invitationUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Invalid invitation URL');
    const expiry = new Date(expiresAt);
    if (!Number.isFinite(expiry.getTime())) throw new TypeError('Invalid invitation expiry');
    const expiryLabel = `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(expiry)} UTC`;
    const name = String(projectName || 'Untitled project');
    const inviter = String(inviterName || 'The project owner');
    const safe = { project: escapeHtml(name), inviter: escapeHtml(inviter), email: escapeHtml(email),
        link: escapeHtml(url.href), expiry: escapeHtml(expiryLabel) };
    const subject = `You're invited to ${name.replace(/[\r\n]+/g, ' ')} | CovAI`;
    const message = `${inviter} invited you to join ${name} on CovAI.\n\nYour access: ${access.label}\n${access.description}\n\nAccept invitation:\n${url.href}\n\nSign in with ${email} to accept.\nExpires: ${expiryLabel}\n\nProject files, test results, chat history and AI memory are shared with project members.\nIf you weren't expecting this invitation, you can ignore this email.\n\nCovAI · Project collaboration`;
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Project invitation | CovAI</title>
<style>@media only screen and (max-width:600px){.email-outer{padding:20px 12px!important}.email-content{padding:28px 24px!important}.email-header{padding:24px!important}.email-title{font-size:26px!important;line-height:34px!important}}</style>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f8;font-family:Arial,Helvetica,sans-serif;color:#17202e;-webkit-text-size-adjust:100%;">
<div style="display:none!important;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;mso-hide:all;">${safe.inviter} invited you to ${safe.project} as ${access.label}. Accept your invitation to get started.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f8">
<tr><td class="email-outer" align="center" style="padding:40px 20px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e1e4ec;border-radius:12px;overflow:hidden;">
<tr><td class="email-header" bgcolor="#10151d" style="padding:26px 36px;background-color:#10151d;border-radius:11px 11px 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="34" height="34" align="center" bgcolor="#6d5dfb" style="width:34px;height:34px;border-radius:8px;background-color:#6d5dfb;color:#ffffff;font-family:Consolas,monospace;font-size:17px;font-weight:bold;">&gt;_</td>
<td style="padding-left:12px;font-size:21px;line-height:28px;font-weight:bold;letter-spacing:-0.5px;color:#ffffff;">CovAI</td>
</tr></table>
</td></tr>
<tr><td class="email-content" style="padding:36px;">
<p style="margin:0 0 12px;color:#6d5dfb;font-size:11px;line-height:16px;font-weight:bold;letter-spacing:1.5px;">PROJECT INVITATION</p>
<h1 class="email-title" style="margin:0 0 18px;font-size:30px;line-height:38px;letter-spacing:-0.8px;font-weight:bold;color:#17202e;">You've been invited to collaborate.</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#526073;overflow-wrap:anywhere;"><strong style="color:#17202e;">${safe.inviter}</strong> invited you to join a project on CovAI.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f7fc" style="background-color:#f7f7fc;border:1px solid #e5e3f4;border-radius:8px;">
<tr><td style="padding:20px 22px 16px;">
<p style="margin:0 0 7px;font-size:11px;line-height:16px;font-weight:bold;color:#647084;letter-spacing:1px;">PROJECT</p>
<p style="margin:0;font-size:18px;line-height:26px;font-weight:bold;color:#17202e;overflow-wrap:anywhere;word-break:break-word;">${safe.project}</p>
</td></tr>
<tr><td style="padding:0 22px 20px;">
<p style="margin:0 0 7px;font-size:12px;line-height:18px;color:#526073;">Your access <strong style="color:#5745d9;">&nbsp;${access.label}</strong></p>
<p style="margin:0;font-size:13px;line-height:21px;color:#526073;">${access.description}</p>
</td></tr></table>
<p style="margin:24px 0 20px;font-size:14px;line-height:23px;color:#526073;">Sign in with <strong style="color:#17202e;word-break:break-all;">${safe.email}</strong> to accept this invitation.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="#6d5dfb" style="background-color:#6d5dfb;border-radius:7px;mso-padding-alt:14px 26px;">
<a href="${safe.link}" style="display:inline-block;padding:14px 26px;border:1px solid #6d5dfb;border-radius:7px;color:#ffffff;font-size:14px;line-height:20px;font-weight:bold;text-decoration:none;">Accept invitation</a>
</td></tr></table>
<p style="margin:14px 0 24px;font-size:12px;line-height:19px;color:#68768a;">Expires ${safe.expiry}</p>
<p style="margin:0 0 24px;padding-left:14px;border-left:3px solid #ddd7ff;font-size:13px;line-height:21px;color:#68768a;">Project files, test results, chat history and AI memory are shared with project members.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-top:22px;border-top:1px solid #e9ebf0;">
<p style="margin:0 0 8px;font-size:12px;line-height:19px;color:#68768a;">If the button doesn't work, copy this link into your browser:</p>
<p style="margin:0;font-size:12px;line-height:20px;word-break:break-all;overflow-wrap:anywhere;"><a href="${safe.link}" style="color:#5745d9;text-decoration:underline;word-break:break-all;">${safe.link}</a></p>
</td></tr></table>
</td></tr>
<tr><td style="padding:22px 28px;border-top:1px solid #e9ebf0;background-color:#fafbfe;border-radius:0 0 11px 11px;text-align:center;">
<p style="margin:0 0 5px;font-size:12px;line-height:19px;font-weight:bold;color:#526073;">CovAI &middot; Project collaboration</p>
<p style="margin:0;font-size:12px;line-height:19px;color:#7b8799;">If you weren't expecting this invitation, you can ignore this email.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
    return { subject, message, html };
}
