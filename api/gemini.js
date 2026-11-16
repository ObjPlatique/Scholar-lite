// Vercel Serverless Function: streams Gemini output to the browser.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Thiếu biến môi trường GEMINI_API_KEY trong cấu hình Vercel." });
  }

  const { prompt, systemInstruction = "", maxOutputTokens = 550 } = req.body || {};
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "Prompt không hợp lệ." });
  }

  const safeMaxTokens = Math.min(4096, Math.max(128, Number(maxOutputTokens) || 550));
  const models = [...new Set([
    process.env.GEMINI_MODEL,
    "gemini-3.5-flash-lite",
    "gemini-3.7-flash",
    "gemini-3.8-flash"
  ].filter(Boolean))];

  let upstream;
  let lastError = "";
  let selectedModel = "";

  // Try a low-latency model first, then fall back if Google is overloaded.
  for (const model of models) {
    const payload = {
      model,
      input: prompt.slice(0, 18000),
      store: false,
      stream: true,
      generation_config: { max_output_tokens: safeMaxTokens }
    };
    if (typeof systemInstruction === "string" && systemInstruction.trim()) {
      payload.system_instruction = systemInstruction.slice(0, 5000);
    }

    try {
      upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      console.error("Gemini connection error:", error);
      return res.status(502).json({ error: "Máy chủ không kết nối được Gemini API." });
    }

    if (upstream.ok) {
      selectedModel = model;
      break;
    }

    const result = await upstream.json().catch(() => ({}));
    lastError = result.error?.message || ("Gemini API trả về HTTP " + upstream.status);
    console.error("Gemini model error:", model, upstream.status, lastError);

    // Only fall back for temporary capacity/rate-limit/server errors.
    if (![429, 500, 502, 503, 504].includes(upstream.status)) {
      return res.status(upstream.status).json({ error: lastError, code: result.error?.status || null });
    }
  }

  if (!upstream || !upstream.ok) {
    return res.status(503).json({
      error: "Các mô hình Gemini hiện đều quá tải. Vui lòng thử lại sau ít phút.",
      detail: lastError
    });
  }
  console.info("Gemini model selected:", selectedModel);

  if (!upstream.body) {
    return res.status(502).json({ error: "Gemini không trả về luồng dữ liệu." });
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const send = (data) => {
    if (!res.writableEnded) res.write("data: " + JSON.stringify(data) + "\n\n");
  };

  const processEvent = (raw) => {
    const data = raw.split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let event;
    try { event = JSON.parse(data); } catch { return; }

    if (event.event_type === "error" || event.error) {
      send({ error: event.error?.message || "Gemini gặp lỗi trong khi tạo câu trả lời." });
      return;
    }
    if (event.event_type === "step.delta" && event.delta?.type === "text" &&
        typeof event.delta.text === "string" && event.delta.text) {
      send({ text: event.delta.text });
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      for (const event of events) processEvent(event);
    }
    buffer += decoder.decode();
    if (buffer.trim()) processEvent(buffer);
  } catch (error) {
    console.error("Gemini stream error:", error);
    send({ error: "Luồng phản hồi bị gián đoạn. Hãy thử gửi lại câu hỏi." });
  } finally {
    if (!res.writableEnded) res.end();
  }
};
