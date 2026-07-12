import { config } from '../../config.js';

export async function generateGeminiResponse({ systemPrompt, userMessage, context }) {
  if (!config.ai.geminiApiKey) throw new Error('GEMINI_API_KEY is not configured');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.ai.model)}:generateContent?key=${encodeURIComponent(config.ai.geminiApiKey)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: `${userMessage}\n\nStructured Nirvana context:\n${JSON.stringify(context || {}, null, 2)}` }] }],
      generationConfig: { maxOutputTokens: config.ai.maxOutputTokens, temperature: 0.25 }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Gemini request failed with HTTP ${response.status}`);
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || 'The AI provider returned no text.';
}
