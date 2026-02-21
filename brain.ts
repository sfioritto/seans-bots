import { createBrain } from '@positronic/core';
import { components } from './components/index.js';
import gmail from './services/gmail.js';
import ntfy from './services/ntfy.js';
import github from './services/github.js';
import slack from './services/slack.js';
import hn from './services/hn.js';

export const brain = createBrain({
  services: { gmail, ntfy, github, slack, hn },
  components,
});