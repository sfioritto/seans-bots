import { createBrain, defaultTools } from '@positronic/core';
import { createMem0Provider, createMem0Tools } from '@positronic/mem0';
import { components } from './components/index.js';
import { serviceTools } from './tools/index.js';
import gmail from './services/gmail.js';
import ntfy from './services/ntfy.js';
import github from './services/github.js';
import slack from './services/slack.js';
import hn from './services/hn.js';

const memoryProvider = process.env.MEM0_API_KEY
  ? createMem0Provider({ apiKey: process.env.MEM0_API_KEY })
  : undefined;

const memoryTools = createMem0Tools();

const { consoleLog, print, ...baseTools } = defaultTools;

export const brain = createBrain({
  services: { gmail, ntfy, github, slack, hn },
  components,
  defaultTools: {
    ...baseTools,
    ...serviceTools,
    ...memoryTools,
  },
  memory: memoryProvider,
});