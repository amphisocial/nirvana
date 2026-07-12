import OpenAI from 'openai';
import { config } from '../../config.js';

let client;

export async function generateOpenAIResponse({ systemPrompt, userMessage, context }) {
  if (!config.ai.openaiApiKey) throw new Error('OPENAI_API_KEY is not configured');
  client ||= new OpenAI({ apiKey: config.ai.openaiApiKey });
  const response = await client.responses.create({
    model: config.ai.model,
    max_output_tokens: config.ai.maxOutputTokens,
    instructions: systemPrompt,
    input: `${userMessage}\n\nStructured Nirvana context:\n${JSON.stringify(context || {}, null, 2)}`
  });
  return response.output_text || 'The AI provider returned no text.';
}
