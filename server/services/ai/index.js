import { config } from '../../config.js';
import { generateMockResponse } from './mock.js';
import { generateOpenAIResponse } from './openai.js';
import { generateGeminiResponse } from './gemini.js';
import { generateAnthropicResponse } from './anthropic.js';

const providers = {
  mock: generateMockResponse,
  openai: generateOpenAIResponse,
  gemini: generateGeminiResponse,
  anthropic: generateAnthropicResponse
};

export async function generateAiResponse(payload) {
  const generate = providers[config.ai.provider];
  if (!generate) throw new Error(`Unsupported AI_PROVIDER: ${config.ai.provider}`);
  return generate(payload);
}
