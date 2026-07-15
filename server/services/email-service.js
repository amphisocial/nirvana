import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter = null;

function cleanHeader(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function normalizedAppUrl() {
  return String(config.appUrl || 'http://localhost:5015').replace(/\/+$/, '');
}

export function emailConfigurationStatus() {
  if (!config.email.enabled) {
    return { enabled: false, configured: false, reason: 'SMTP delivery is disabled' };
  }
  const missing = [];
  if (!config.email.host) missing.push('SMTP_HOST');
  if (!config.email.fromEmail) missing.push('SMTP_FROM_EMAIL');
  if (Boolean(config.email.user) !== Boolean(config.email.password)) {
    missing.push('SMTP_USER and SMTP_PASSWORD must be set together');
  }
  return {
    enabled: true,
    configured: missing.length === 0,
    missing,
    reason: missing.length ? `Missing SMTP configuration: ${missing.join(', ')}` : null
  };
}

function getTransporter() {
  const status = emailConfigurationStatus();
  if (!status.configured) throw new Error(status.reason || 'SMTP is not configured');
  if (transporter) return transporter;

  const auth = config.email.user && config.email.password
    ? { user: config.email.user, pass: config.email.password }
    : undefined;

  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    ...(auth ? { auth } : {}),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true
  });
  return transporter;
}

export function buildHouseholdInviteMessage({
  to,
  inviterName,
  householdName,
  role = 'member',
  accepted = false
}) {
  const recipient = cleanHeader(to).toLowerCase();
  const inviter = cleanHeader(inviterName) || 'A Nirvana user';
  const household = cleanHeader(householdName) || 'a shared Nirvana household';
  const accessLabel = role === 'viewer' ? 'view-only access' : 'shared access';
  const appUrl = normalizedAppUrl();

  const subject = accepted
    ? `You now have access to ${household} in Nirvana`
    : `${inviter} invited you to join their Nirvana household`;

  const intro = accepted
    ? `${inviter} has given you ${accessLabel} to ${household} in Nirvana.`
    : `${inviter} invited you to join ${household} in Nirvana with ${accessLabel}.`;

  const action = accepted
    ? 'Sign in to open the shared household.'
    : `Sign in with the exact Google account <strong>${escapeHtml(recipient)}</strong>. Nirvana will recognize the pending invitation and connect you to the shared household.`;

  const text = [
    intro,
    '',
    accepted
      ? `Open Nirvana: ${appUrl}`
      : `Sign in to Nirvana with this exact Google account: ${recipient}`,
    appUrl,
    '',
    'For your security, do not forward this invitation. Access is tied to the invited email address.'
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f8fc;font-family:Arial,Helvetica,sans-serif;color:#102a43;">
    <div style="max-width:620px;margin:0 auto;padding:32px 18px;">
      <div style="background:#ffffff;border:1px solid #d8e6f2;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(16,42,67,.08);">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#0b3a67,#1976c5);color:#ffffff;">
          <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">Nirvana</div>
          <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25;">${escapeHtml(accepted ? 'Shared household access' : 'You’re invited')}</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">${escapeHtml(intro)}</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#486581;">${action}</p>
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:12px 20px;background:#1976c5;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;">Open Nirvana</a>
          <p style="margin:26px 0 0;padding-top:18px;border-top:1px solid #e7eef5;font-size:12px;line-height:1.55;color:#829ab1;">For your security, do not forward this invitation. Access is tied to ${escapeHtml(recipient)}.</p>
        </div>
      </div>
    </div>
  </body>
</html>`;

  return { to: recipient, subject, text, html };
}

export async function sendHouseholdInviteEmail(input) {
  const status = emailConfigurationStatus();
  if (!status.enabled) {
    return { sent: false, skipped: true, reason: status.reason };
  }
  if (!status.configured) throw new Error(status.reason);

  const message = buildHouseholdInviteMessage(input);
  const info = await getTransporter().sendMail({
    from: { name: cleanHeader(config.email.fromName) || 'Nirvana', address: config.email.fromEmail },
    to: message.to,
    ...(config.email.replyTo ? { replyTo: config.email.replyTo } : {}),
    subject: message.subject,
    text: message.text,
    html: message.html
  });

  return { sent: true, skipped: false, messageId: info.messageId || null };
}
