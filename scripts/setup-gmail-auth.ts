#!/usr/bin/env tsx
/**
 * Gmail OAuth Setup Script
 *
 * This script helps you get refresh tokens for your Gmail accounts.
 * You'll need to run this once for each Gmail account you want to access.
 *
 * Prerequisites:
 * 1. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in your .env file
 * 2. Make sure you've configured the OAuth consent screen in Google Cloud Console
 *
 * Usage:
 *   npx tsx scripts/setup-gmail-auth.ts
 */

import { google } from 'googleapis';
import * as http from 'http';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_PORT = 8085;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Error: GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in .env');
  console.error('\nPlease add these to your .env file:');
  console.error('GMAIL_CLIENT_ID=your-client-id');
  console.error('GMAIL_CLIENT_SECRET=your-client-secret');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Generate the authorization URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // Required to get refresh token
  scope: ['https://www.googleapis.com/auth/gmail.modify'],
  prompt: 'consent' // Force consent screen to ensure we get refresh token
});

// Start a local server to receive the OAuth callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '', REDIRECT_URI);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h1>Authorization failed</h1><p>Error: ${error}</p>`);
    console.error(`\n❌ Authorization failed: ${error}`);
    server.close();
    process.exit(1);
  }

  if (code) {
    try {
      const { tokens } = await oauth2Client.getToken(code);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Success!</h1><p>You can close this window and return to the terminal.</p>');

      console.log('\n✅ Success! Here is your refresh token:\n');
      console.log(`   ${tokens.refresh_token}\n`);
      console.log('Add this to your .env file as:');
      console.log(`GMAIL_REFRESH_TOKEN_ACCOUNT1=${tokens.refresh_token}`);
      console.log('\n(Use ACCOUNT2, ACCOUNT3, etc. for additional accounts)\n');
      console.log('👋 Setup complete. Run this script again for each additional Gmail account.');

    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<h1>Error</h1><p>Failed to exchange code for tokens.</p>');
      console.error('\n❌ Error getting tokens:', err);
    }

    server.close();
    process.exit(0);
  }
});

server.listen(REDIRECT_PORT, () => {
  console.log('🔐 Gmail OAuth Setup\n');
  console.log('A browser window will open for authorization.');
  console.log('If it doesn\'t open automatically, visit this URL:\n');
  console.log(`   ${authUrl}\n`);
  console.log(`Waiting for authorization on http://localhost:${REDIRECT_PORT}...\n`);

  // Try to open the URL in the default browser
  const openCommand = process.platform === 'darwin' ? 'open' :
                      process.platform === 'win32' ? 'start' : 'xdg-open';
  import('child_process').then(({ exec }) => {
    exec(`${openCommand} "${authUrl}"`);
  });
});
