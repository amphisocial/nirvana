export async function generateMockResponse({ userMessage, context }) {
  const contextNote = context ? ' I used the structured Nirvana context supplied with your question.' : '';
  return {
    text: `Nirvana is running with the mock AI provider.${contextNote}\n\nYour question was: **${userMessage}**\n\nConfigure AI_PROVIDER and the matching API key to enable a full grounded analysis.`,
    sources: []
  };
}
