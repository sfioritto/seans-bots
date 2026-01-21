import { BrainRunner } from '@positronic/core';
import { VercelClient } from '@positronic/client-vercel';
import { google } from '@ai-sdk/google';
import { components } from '@positronic/gen-ui-components';

export const runner = new BrainRunner({
  adapters: [],
  client: new VercelClient(google('gemini-3-pro-preview')),
  resources: {},
}).withComponents(components);
