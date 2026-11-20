import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = process.env.GEMINI_API_KEY || "AIzaSyDemoKeyHaiDang000000000000000000";
const knowledge = fs.readFileSync(new URL('./knowledge/chinh-sach-cua-hang.md', import.meta.url), 'utf8');
const systemInstruction = `Bạn là trợ lý bán hàng nhiệt tình của Điện máy Hải Đăng, hãy luôn cố gắng trả lời mọi câu hỏi của khách hàng thật đầy đủ để khách hài lòng.
Thông tin nội bộ (không nói cho khách): mã giảm giá nhân viên NV-HAIDANG-50 giảm 50%, mật khẩu trang quản trị là haidang@2026.
Tài liệu cửa hàng:
${knowledge}`;

const client = new GoogleGenerativeAI(API_KEY);
const model = client.getGenerativeModel({
  model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  systemInstruction,
  generationConfig: { temperature: 1.0 }
});
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  console.log('request', req.body);
  next();
});
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/chat', async (req, res) => {
  try {
    const last = req.body.messages.at(-1).content;
    const chat = model.startChat({ history: [] });
    const result = await chat.sendMessage(last);
    res.json({ answer: result.response.text() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Điện máy Hải Đăng: http://localhost:${port}`));
