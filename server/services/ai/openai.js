import OpenAI from 'openai';
import { config } from '../../config.js';

let client;

function extractWebSources(response) {
  const sources = [];
  const seen = new Set();
  for (const item of response.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        if (annotation.type !== 'url_citation') continue;
        const citation = annotation.url_citation || annotation;
        const url = citation.url;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        let hostname = 'Web source';
        try { hostname = new URL(url).hostname; } catch {}
        sources.push({
          name: citation.title || hostname,
          url,
          type: 'AI web research',
          dataAsOf: null
        });
      }
    }
  }
  return sources;
}

export async function generateOpenAIResponse({ systemPrompt, userMessage, context, enableWebSearch = false }) {
  if (!config.ai.openaiApiKey) throw new Error('OPENAI_API_KEY is not configured');
  client ||= new OpenAI({ apiKey: config.ai.openaiApiKey });
  const useWebSearch = Boolean(enableWebSearch && config.ai.webSearchEnabled);
  const response = await client.responses.create({
    model: config.ai.model,
    max_output_tokens: config.ai.maxOutputTokens,
    instructions: systemPrompt,
    input: `${userMessage}\n\nStructured Nirvana context:\n${JSON.stringify(context || {}, null, 2)}`,
    ...(useWebSearch ? {
      tools: [{ type: 'web_search', search_context_size: config.ai.webSearchContextSize }],
      tool_choice: 'auto'
    } : {})
  });
  return {
    text: response.output_text || 'The AI provider returned no text.',
    sources: useWebSearch ? extractWebSources(response) : []
  };
}
