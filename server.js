// server.js - Complete Ragnok Verification Server
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const Twitter = require('twitter-api-v2').default;
const { Client: DiscordClient } = require('discord.js');
const rateLimit = require('express-rate-limit');

// Initialize apps
const app = express();
const discordClient = new DiscordClient({ intents: [] });

// Twitter Client
const twitterClient = new Twitter({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET
});

// Discord Login (in background)
discordClient.login(process.env.DISCORD_BOT_TOKEN).catch(console.error);

// ======================
// MIDDLEWARE
// ======================
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5501'
}));
app.use(express.json());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
}));

// ======================
// HELPER FUNCTIONS
// ======================

/**
 * Verify Twitter handle exists
 */
async function verifyTwitter(handle) {
  try {
    const user = await twitterClient.v2.userByUsername(handle.replace('@', ''));
    return !!user.data;
  } catch (error) {
    console.error('Twitter verification failed:', error);
    return false;
  }
}

/**
 * Verify Discord user is in guild
 */
async function verifyDiscord(handle) {
  try {
    const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const members = await guild.members.fetch();
    const [username, discriminator] = handle.split('#');
    
    return members.some(member => 
      member.user.username === username && 
      member.user.discriminator === discriminator
    );
  } catch (error) {
    console.error('Discord verification failed:', error);
    return false;
  }
}

/**
 * Generate ECDSA signature for contract verification
 */
async function generateSignature(walletAddress, twitterHandle, discordHandle) {
  const signer = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY);
  const messageHash = ethers.solidityPackedKeccak256(
    ['address', 'string', 'string'],
    [walletAddress, twitterHandle, discordHandle]
  );
  return await signer.signMessage(ethers.getBytes(messageHash));
}

// ======================
// ROUTES
// ======================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

/**
 * Main verification endpoint
 */
app.post('/api/verify', async (req, res) => {
  try {
    // 1. Validate input
    const { walletAddress, twitterHandle, discordHandle } = req.body;
    
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    if (!twitterHandle?.startsWith('@')) {
      return res.status(400).json({ error: 'Twitter handle must start with @' });
    }

    if (!discordHandle?.includes('#')) {
      return res.status(400).json({ error: 'Discord handle must contain #' });
    }

    // 2. Verify socials
    const [twitterValid, discordValid] = await Promise.all([
      verifyTwitter(twitterHandle),
      verifyDiscord(discordHandle)
    ]);

    if (!twitterValid || !discordValid) {
      return res.status(403).json({ 
        error: 'Social verification failed',
        details: {
          twitter: twitterValid,
          discord: discordValid
        }
      });
    }

    // 3. Generate and return signature
    const signature = await generateSignature(walletAddress, twitterHandle, discordHandle);
    
    res.json({
      success: true,
      signature,
      socials: {
        twitter: twitterHandle,
        discord: discordHandle
      }
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
});

// ======================
// ERROR HANDLING
// ======================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong' });
});

// ======================
// SERVER START
// ======================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Ragnok verification server running on port ${PORT}`);
  console.log(`CORS allowed for: ${process.env.FRONTEND_URL || 'http://localhost:5501'}`);
});