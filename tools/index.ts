/**
 * Service tools - re-exported from service modules
 *
 * Each service defines its own AI-callable tools alongside the service
 * implementation. This file aggregates them for convenient access.
 */

import { gmailTools } from '../services/gmail.js';
import { githubTools } from '../services/github.js';
import { slackTools } from '../services/slack.js';
import { hnTools } from '../services/hn.js';
import { ntfyTools } from '../services/ntfy.js';

export { gmailTools } from '../services/gmail.js';
export { githubTools } from '../services/github.js';
export { slackTools } from '../services/slack.js';
export { hnTools } from '../services/hn.js';
export { ntfyTools } from '../services/ntfy.js';

/**
 * All service tools combined into a single object
 */
export const serviceTools = {
  ...gmailTools,
  ...githubTools,
  ...slackTools,
  ...hnTools,
  ...ntfyTools,
};

export default serviceTools;
