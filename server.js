import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import multer from 'multer';
import { log } from 'console';

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const API_KEY = "sk-owqnceflrqxczqeflwoenzwofmsgmagemrajqqhyxfyawrng";

const storage = multer.memoryStorage();
const upload = multer({ storage });

const KB_FILE = "knowledge_base.json";
let documentChunks = [];

// ==============================
// 文档分片
// ==============================
function splitText(text, chunkSize = 1000) {
  const chunks = [];
  let current = "";
  const sentences = text.split(/[。！？；\n]/).filter(Boolean);

  sentences.forEach(s => {
    s = s.trim();
    if (current.length + s.length > chunkSize) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += " " + s;
    }
  });

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ==============================
// 检索引擎
// ==============================
function getWords(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean);
}

function searchDocs(query, topK = 3) {
  if (!documentChunks.length) return [];
  const qWords = getWords(query);
  return documentChunks
    .map(chunk => ({
      chunk,
      score: qWords.reduce((s, w) => s + (chunk.toLowerCase().includes(w) ? 1 : 0), 0)
    }))
    .filter(i => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(i => i.chunk);
}

// ==============================
// 知识库持久化
// ==============================
async function saveKB() {
  await fs.writeFile(KB_FILE, JSON.stringify(documentChunks, null, 2));
}

async function loadKB() {
  try {
    const data = await fs.readFile(KB_FILE, "utf8");
    documentChunks = JSON.parse(data) || [];
  } catch {
    documentChunks = [];
  }
}
loadKB();

// ==============================
// 上传 TXT / MD（废弃PDF，彻底无警告）
// ==============================
app.post("/api/rag/upload", upload.single("file"), async (req, res) => {
  try {
    let text = req.file.buffer.toString("utf8");
    const chunks = splitText(text);
    documentChunks.push(...chunks);
    await saveKB();

    res.json({
      success: true,
      chunks: chunks.length,
      total: documentChunks.length,
      msg: `✅ 上传成功，新增 ${chunks.length} 段`
    });
  } catch (err) {
    res.status(500).json({ error: "解析失败：" + err.message });
  }
});

// ==============================
// 清空知识库
// ==============================
app.post("/api/rag/clear", async (req, res) => {
  documentChunks = [];
  await saveKB();
  res.json({ success: true, msg: "✅ 已清空知识库" });
});

// ==============================
// RAG 问答（流式）
// ==============================
app.post("/api/rag/chat", async (req, res) => {
  debugger
  try {
    const { question } = req.body;
    const refs = searchDocs(question);
    console.log(refs)
    const prompt = `
你是企业智能助手，不用严格依据参考文档回答。

参考文档：
${refs.join("\n---\n")}

用户问题：${question}
回答：`;

    const response = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek-ai/DeepSeek-V3.2",
        messages: [{ role: "user", content: prompt }],
        stream: true,
        temperature: 0.8
      })
    });

    res.setHeader("Content-Type", "text/event-stream");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    async function stream() {
      const { done, value } = await reader.read();
      if (done) return res.end();
      res.write(decoder.decode(value));
      stream();
    }
    stream();

  } catch (err) {
    res.end();
  }
});

app.listen(3000, () => {
  console.log("✅ 企业级 RAG 服务启动: http://localhost:3000");
});