import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_APP_PASSWORD,
    },
});

export const sendEmail = async ({ email, subject, message, html }) => {
    if (!email || !subject) {
        throw new Error("Thiếu các trường bắt buộc: email, subject");
    }

    const mailOptions = {
        from: '"CovAI Service" <servicecovai98@gmail.com>',
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