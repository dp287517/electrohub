#!/usr/bin/env node
// generate-pwa-icons.js
// Generates all PWA icon sizes from SVG source

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, '..', 'public', 'icons');

// Icon sizes needed for PWA
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const badgeSizes = [72, 96];

// Create a beautiful gradient icon programmatically
async function createMainIcon(size) {
  // Create SVG with gradient background and lightning bolt
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1f73ff"/>
          <stop offset="100%" style="stop-color:#0f3e99"/>
        </linearGradient>
        <linearGradient id="bolt" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#ffffff"/>
          <stop offset="100%" style="stop-color:#e0e7ff"/>
        </linearGradient>
      </defs>
      <!-- Background -->
      <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="url(#bg)"/>
      <!-- Lightning bolt -->
      <g transform="translate(${size * 0.25}, ${size * 0.15}) scale(${size / 100})">
        <path d="M30 0 L10 28 L22 28 L18 50 L40 20 L27 20 L30 0 Z" fill="url(#bolt)"/>
      </g>
    </svg>
  `;

  const outputPath = path.join(iconsDir, `icon-${size}x${size}.png`);
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(outputPath);

  console.log(`✅ Created icon-${size}x${size}.png`);
}

// Create badge icon (for notification badge - should be monochrome)
async function createBadgeIcon(size) {
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="#000"/>
      <g transform="translate(${size * 0.28}, ${size * 0.2}) scale(${size / 100})">
        <path d="M22 0 L8 20 L16 20 L13 35 L28 14 L20 14 L22 0 Z" fill="#fff"/>
      </g>
    </svg>
  `;

  const outputPath = path.join(iconsDir, `badge-${size}x${size}.png`);
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(outputPath);

  console.log(`✅ Created badge-${size}x${size}.png`);
}

// Create Apple Touch Icon (special format for iOS)
async function createAppleTouchIcon() {
  const size = 180;
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1f73ff"/>
          <stop offset="100%" style="stop-color:#0f3e99"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#bg)"/>
      <g transform="translate(${size * 0.25}, ${size * 0.15}) scale(${size / 100})">
        <path d="M30 0 L10 28 L22 28 L18 50 L40 20 L27 20 L30 0 Z" fill="#fff"/>
      </g>
    </svg>
  `;

  const outputPath = path.join(iconsDir, 'apple-touch-icon.png');
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(outputPath);

  console.log(`✅ Created apple-touch-icon.png (180x180)`);
}

// Create favicon.ico (multi-size)
async function createFavicon() {
  const size = 32;
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1f73ff"/>
          <stop offset="100%" style="stop-color:#0f3e99"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="6" fill="url(#bg)"/>
      <g transform="translate(${size * 0.22}, ${size * 0.12}) scale(${size / 100})">
        <path d="M30 0 L10 28 L22 28 L18 50 L40 20 L27 20 L30 0 Z" fill="#fff"/>
      </g>
    </svg>
  `;

  // Create 16x16 and 32x32 PNGs for favicon
  const png32 = await sharp(Buffer.from(svg)).resize(32, 32).png().toBuffer();
  const png16 = await sharp(Buffer.from(svg)).resize(16, 16).png().toBuffer();

  // Save as PNG (browsers will handle it)
  const faviconPath = path.join(__dirname, '..', 'public', 'favicon.png');
  await sharp(png32).toFile(faviconPath);

  console.log(`✅ Created favicon.png (32x32)`);
}

// Create maskable icon (with safe area padding)
async function createMaskableIcon() {
  const size = 512;
  const padding = size * 0.1; // 10% safe zone
  const innerSize = size - (padding * 2);

  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1f73ff"/>
          <stop offset="100%" style="stop-color:#0f3e99"/>
        </linearGradient>
      </defs>
      <!-- Full background for maskable -->
      <rect width="${size}" height="${size}" fill="url(#bg)"/>
      <!-- Centered lightning bolt with safe zone -->
      <g transform="translate(${size * 0.32}, ${size * 0.22}) scale(${size / 140})">
        <path d="M30 0 L10 28 L22 28 L18 50 L40 20 L27 20 L30 0 Z" fill="#fff"/>
      </g>
    </svg>
  `;

  const outputPath = path.join(iconsDir, 'maskable-icon-512x512.png');
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(outputPath);

  console.log(`✅ Created maskable-icon-512x512.png`);
}

async function main() {
  console.log('\n🎨 Generating PWA icons for ElectroHub...\n');

  // Ensure icons directory exists
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  // Generate all main icon sizes
  for (const size of sizes) {
    await createMainIcon(size);
  }

  // Generate badge icons
  for (const size of badgeSizes) {
    await createBadgeIcon(size);
  }

  // Generate special icons
  await createAppleTouchIcon();
  await createMaskableIcon();
  await createFavicon();

  console.log('\n✨ All PWA icons generated successfully!\n');
}

main().catch(console.error);
