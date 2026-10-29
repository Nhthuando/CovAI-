import 'dotenv/config';
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({ ...(process.env.SMTP_HOST ? {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    ...(process.env.SMTP_USERNAME ? { auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD } } : {}),
} : {
    service: "Gmail",
    auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_APP_PASSWORD,
    },
}), connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });

// Read-only SMTP handshake for configuration checks; sends no email.
export const verifyEmailTransport = () => transporter.verify();

export const sendEmail = async ({ email, subject, message, html }) => {
    if (!email || !subject) {
        throw new Error("Missing required fields: email, subject");
    }

    const mailOptions = {
        from: process.env.EMAIL_FROM || (process.env.EMAIL_USERNAME
            ? { name: 'CovAI', address: process.env.EMAIL_USERNAME }
            : '"CovAI Service" <servicecovai98@gmail.com>'),
        to: email,
        subject,
        text: message,
        html: html
        };

    try {
        const info = await transporter.sendMail(mailOptions);
        return info; 
    } catch (err) {
        throw new Error(`Failed to send email to ${email}: ${err.message}`);
    }
};
