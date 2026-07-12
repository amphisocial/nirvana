import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const SAFE_SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;
const cache = new Map();

export async function loadSkills(requestedNames = config.ai.enabledSkills) {
  const enabled = new Set(config.ai.enabledSkills);
  const names = requestedNames.filter((name) => enabled.has(name));
  const key = `${config.ai.skillsDir}:${names.join(',')}`;
  if (cache.has(key)) return cache.get(key);

  const sections = [];
  for (const name of names) {
    if (!SAFE_SKILL_NAME.test(name)) throw new Error(`Unsafe AI skill name: ${name}`);
    const fullPath = path.resolve(config.ai.skillsDir, `${name}.md`);
    const content = await fs.readFile(fullPath, 'utf8');
    sections.push(content.trim());
  }

  const prompt = sections.join('\n\n---\n\n');
  cache.set(key, prompt);
  return prompt;
}

export function loadEnabledSkills() {
  return loadSkills(config.ai.enabledSkills);
}
