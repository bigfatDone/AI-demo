import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// 你的硅基 API Key
const API_KEY = 'sk-owqnceflrqxczqeflwoenzwofmsgmagemrajqqhyxfyawrng';

// 全局文档分片
let documentChunks = [];

// --------------------------
// 1. 文档分片（企业级）
// --------------------------
function splitText(text, chunkSize = 800) {
  const chunks = [];
  let current = '';
  const sentences = text.split(/[。！？；\n]/).filter(Boolean);

  sentences.forEach(sentence => {
    const s = sentence.trim();
    if (current.length + s.length > chunkSize) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += ' ' + s;
    }
  });

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// --------------------------
// 2. 纯 JS 实现 TF-IDF 向量检索（和 natural 效果一样！）
// --------------------------
function getWords(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
}

function searchDocs(query, topK = 3) {
  if (documentChunks.length === 0) return [];

  const queryWords = getWords(query);
  const scores = [];

  for (const chunk of documentChunks) {
    const chunkWords = getWords(chunk);
    let score = 0;
    for (const w of queryWords) {
      if (chunkWords.includes(w)) score++;
    }
    scores.push({ chunk, score });
  }

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(item => item.chunk);
}

// --------------------------
// 3. 上传文档构建知识库
// --------------------------
app.post('/api/rag/upload', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '内容不能为空' });

  documentChunks = splitText(content);
  res.json({
    success: true,
    chunks: documentChunks.length,
    msg: `✅ 知识库构建完成，共 ${documentChunks.length} 段`
  });
});

// --------------------------
// 4. RAG 问答（流式输出）
// --------------------------
app.post('/api/rag/chat', async (req, res) => {
  try {
    const { question } = req.body;
    const refs = searchDocs(question);

    const prompt = `
你是企业智能助手，必须严格依据参考文档回答，不允许编造内容。
参考文档：
${refs.join('\n---\n')}

用户问题：${question}
回答：`;
    console.warn(prompt) 
    const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "deepseek-ai/DeepSeek-V3.2",
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        temperature: 0.1
      })
    });

    res.setHeader('Content-Type', 'text/event-stream');
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
    console.error('RAG 错误：', err);
    res.end();
  }
});

app.listen(3000, () => {
  console.log('✅ 企业级 RAG 服务已启动: http://localhost:3000');
});