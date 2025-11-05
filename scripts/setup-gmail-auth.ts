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
import * as readline from 'readline';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

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
  'urn:ietf:wg:oauth:2.0:oob' // Special redirect URI for installed apps
);

// Generate the authorization URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // Required to get refresh token
  scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  prompt: 'consent' // Force consent screen to ensure we get refresh token
});

console.log('🔐 Gmail OAuth Setup\n');
console.log('Follow these steps:\n');
console.log('1. Visit this URL in your browser:');
console.log(`\n   ${authUrl}\n`);
console.log('2. Sign in with the Gmail account you want to access');
console.log('3. Grant the requested permissions');
console.log('4. Copy the authorization code that appears\n');
console.log('Enter the authorization code here: ');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on('line', async (code: string) => {
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());

    console.log('\n✅ Success! Here is your refresh token:\n');
    console.log(`   ${tokens.refresh_token}\n`);
    console.log('Add this to your .env file as:');
    console.log(`GMAIL_REFRESH_TOKEN_ACCOUNT1=${tokens.refresh_token}`);
    console.log('\n(Use ACCOUNT2, ACCOUNT3, etc. for additional accounts)\n');

  } catch (error) {
    console.error('\n❌ Error getting tokens:', error);
  }

  rl.close();
});

rl.on('close', () => {
  console.log('\n👋 Setup complete. Run this script again for each additional Gmail account.');
  process.exit(0);
});
