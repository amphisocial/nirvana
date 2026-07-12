import { config } from '../../config.js';

export async function generateAnthropicResponse({ systemPrompt, userMessage, context }) {
  if (!config.ai.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ai.anthropicApiKey,
      'anthropic-version': config.ai.anthropicVersion
    },
    body: JSON.stringify({
      model: config.ai.model,
      max_tokens: config.ai.maxOutputTokens,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: 'user', content: `${userMessage}\n\nStructured Nirvana context:\n${JSON.stringify(context || {}, null, 2)}` }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Anthropic request failed with HTTP ${response.status}`);
  return {
    text: data.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n') || 'The AI provider returned no text.',
    sources: []
  };
}
