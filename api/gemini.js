// Vercel Serverless Function: keeps the Gemini API key on the server.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Thiếu biến môi trường GEMINI_API_KEY trong cấu hình Vercel." });
  }

  const { prompt, systemInstruction = "", maxOutputTokens = 700 } = req.body || {};
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "Prompt không hợp lệ." });
  }
  const safeMaxTokens = Math.min(4096, Math.max(128, Number(maxOutputTokens) || 700));
  const payload = {
    model: "gemini-3.8-flash",
    input: prompt.slice(0, 30000),
    store: false,
    generation_config: { max_output_tokens: safeMaxTokens }
  };
  if (typeof systemInstruction === "string" && systemInstruction.trim()) {
    payload.system_instruction = systemInstruction.slice(0, 8000);
  }

  try {
    const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload)
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = result.error?.message || ("Gemini API trả về HTTP " + upstream.status);
      return res.status(upstream.status).json({ error: message });
    }
    const text = (result.steps || [])
      .filter(step => step.type === "model_output")
      .flatMap(step => step.content || [])
      .filter(part => part.type === "text" && typeof part.text === "string")
      .map(part => part.text)
      .join("\n")
      .trim();
    if (!text) {
      return res.status(502).json({ error: "Gemini không trả về văn bản. Trạng thái: " + (result.status || "không xác định") });
    }
    return res.status(200).json({ text });
  } catch (error) {
    console.error("Gemini proxy error:", error);
    return res.status(502).json({ error: "Máy chủ không kết nối được Gemini API. Hãy kiểm tra kết nối mạng và thử lại." });
  }
}