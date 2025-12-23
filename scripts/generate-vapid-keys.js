#!/usr/bin/env node
// generate-vapid-keys.js
// Generates VAPID keys for Web Push notifications

import webpush from 'web-push';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

console.log('\n🔐 Generating VAPID keys for Push Notifications...\n');

const vapidKeys = webpush.generateVAPIDKeys();

console.log('✅ VAPID Keys Generated:\n');
console.log('VAPID_PUBLIC_KEY=' + vapidKeys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + vapidKeys.privateKey);
console.log('VAPID_SUBJECT=mailto:admin@electrohub.io');
console.log('');

// Check if .env exists
if (fs.existsSync(envPath)) {
  let envContent = fs.readFileSync(envPath, 'utf8');

  // Check if VAPID keys already exist
  if (envContent.includes('VAPID_PUBLIC_KEY')) {
    console.log('⚠️  VAPID keys already exist in .env file');
    console.log('   If you want to regenerate, remove the existing VAPID_ lines first.\n');
  } else {
    // Append VAPID keys to .env
    const vapidEnv = `
# Push Notification VAPID Keys
VAPID_PUBLIC_KEY=${vapidKeys.publicKey}
VAPID_PRIVATE_KEY=${vapidKeys.privateKey}
VAPID_SUBJECT=mailto:admin@electrohub.io
`;

    fs.appendFileSync(envPath, vapidEnv);
    console.log('✅ VAPID keys added to .env file\n');
  }
} else {
  // Create new .env with VAPID keys
  const envContent = `# Push Notification VAPID Keys
VAPID_PUBLIC_KEY=${vapidKeys.publicKey}
VAPID_PRIVATE_KEY=${vapidKeys.privateKey}
VAPID_SUBJECT=mailto:admin@electrohub.io
`;

  fs.writeFileSync(envPath, envContent);
  console.log('✅ Created .env file with VAPID keys\n');
}

console.log('📱 Push notifications are now ready to use!\n');
console.log('Note: Keep VAPID_PRIVATE_KEY secret and never commit it to git.\n');
