require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalFollow, GoalNear, GoalBlock } } = require('mineflayer-pathfinder');
const http = require('http');
const https = require('https');

// Configuration constants
const MC_CHAT_CHANNEL = 'minecraft-chat';
const RENDER_URL = 'https://smp-bot-8k1e.onrender.com';
const PING_INTERVAL = 2 * 60 * 1000; // 2 minutes
const AUTHORIZED_USER_IDS = ['724265072364617759', '498447966252695552']; // Admin user IDs
let lastHealthCheck = Date.now();
let isServerOnline = false;

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ]
});

// Bot instance
let bot;

// Variables to track bot state
let isFollowing = false;
let followingPlayer = null;
let isAttacking = false;
let attackingMob = null;
let autoAttackEnabled = false;
let autoAttackRadius = 5; // Default radius for auto-attack

// Initialize Minecraft bot
const initMinecraftBot = () => {
  console.log('Attempting to connect to Minecraft server...');
  
  // Handle any uncaught errors to prevent crashes
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    // Don't exit the process, just log the error
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
  });
  
  const mcBot = mineflayer.createBot({
    plugins: [pathfinder],
    host: process.env.MC_HOST || 'in02.servoid.pro',
    port: parseInt(process.env.MC_PORT || '8641'),
    username: 'Disaster',
    auth: 'offline',
    version: process.env.MC_VERSION || false,
    hideErrors: true,
    skipValidation: true,
    viewDistance: 'tiny',
    hideInTabList: true,
    skinParts: {
      showCape: true,
      showJacket: true,
      showLeftSleeve: true,
      showRightSleeve: true,
      showLeftPants: true,
      showRightPants: true,
      showHat: true
    },
    skin: './assets/skins/botskin.png'
  });

  

  // Minecraft bot event handlers
  mcBot.on('spawn', () => {
    console.log('Minecraft bot connected to server');
    isServerOnline = true;
    updateBotStatus();
    
    // Initialize pathfinder with appropriate movements
    const mcData = require('minecraft-data')(mcBot.version);
    const movements = new Movements(mcBot, mcData);
    
    // Configure movements for SMP environment
    movements.allowSprinting = true;
    movements.canDig = false;  // Don't dig blocks in SMP
    movements.maxDropDown = 4; // Maximum safe drop distance
    
    // Apply movements to pathfinder
    mcBot.pathfinder.setMovements(movements);
    
    // Add pathfinder error handling to prevent crashes
    mcBot.on('path_update', (results) => {
      if (results.status === 'noPath') {
        console.log('No path found, handling gracefully');
        // Clear the current goal to prevent the bot from getting stuck
        mcBot.pathfinder.setGoal(null);
      }
    });
    
    // Add pathfinder timeout to prevent infinite pathfinding
    mcBot.on('goal_reached', (goal) => {
      console.log('Goal reached successfully');
    });
    
    // Handle pathfinder errors
    mcBot.on('path_reset', (reason) => {
      console.log('Path reset:', reason);
    });
    
    // Send server online message to Discord
    const channel = client.channels.cache.find(ch => ch.name === MC_CHAT_CHANNEL);
    if (channel) {
      const embed = new EmbedBuilder()
        .setTitle('Server Connection Established')
        .setDescription(`Connected to Oggy's SMP server`)
        .setColor('#00ff00')
        .setTimestamp();
      
      channel.send({ embeds: [embed] });
    }
  });

  mcBot.on('chat', (username, message) => {
    // Forward in-game chat to Discord
    if (username === mcBot.username) return; // Don't echo the bot's own messages
    
    const channel = client.channels.cache.find(ch => ch.name === MC_CHAT_CHANNEL);
    if (channel) {
      // Check if the message is from a player or system
      if (username === '') {
        // System message
        channel.send(`**[SERVER]** ${message}`);
      } else {
        // Player message
        channel.send(`**${username}**: ${message}`);
      }
    }
  });

  mcBot.on('playerJoined', (player) => {
    // Don't send message if it's the bot itself
    if (player.username === mcBot.username) return;
    
    const channel = client.channels.cache.find(ch => ch.name === MC_CHAT_CHANNEL);
    if (channel) {
      channel.send(`🟢 **${player.username}** joined the game`);
    }
  });

  mcBot.on('playerLeft', (player) => {
    // Don't send message if it's the bot itself
    if (player.username === mcBot.username) return;
    
    const channel = client.channels.cache.find(ch => ch.name === MC_CHAT_CHANNEL);
    if (channel) {
      channel.send(`🔴 **${player.username}** left the game`);
    }
  });

  mcBot.on('death', () => {
    const channel = client.channels.cache.find(ch => ch.name === MC_CHAT_CHANNEL);
    if (channel) {
      channel.send(`💀 Bot died and will attempt to respawn`);
    }
  });

  mcBot.on('kicked', (reason, loggedIn) => {
    console.log('Bot was kicked from server:', reason);
    isServerOnline = false;
    updateBotStatus();
    
    const channel = client.channels.cache.find(ch => ch.name === MC_CHAT_CHANNEL);
    if (channel) {
      const embed = new EmbedBuilder()
        .setTitle('Disconnected from Server')
        .setDescription(`Reason: ${reason}`)
        .setColor('#ff0000')
        .setTimestamp();
      
      channel.send({ embeds: [embed] });
    }
    
    setTimeout(initMinecraftBot, 30000); // Attempt to reconnect after 30 seconds
  });

  mcBot.on('error', (err) => {
    console.error('Minecraft bot error:', err);
    isServerOnline = false;
    updateBotStatus();
    
    const channel = client.channels.cache.find(ch => ch.name === MC_CHAT_CHANNEL);
    if (channel) {
      channel.send(`⚠️ Connection error: ${err.message}. Attempting to reconnect in 30 seconds...`);
    }
    
    setTimeout(initMinecraftBot, 30000);
  });

  mcBot.on('end', () => {
    isServerOnline = false;
    updateBotStatus();
    console.log('Connection to Minecraft server ended');
    
    // Only attempt to reconnect if not kicked (to avoid duplicate reconnection attempts)
    if (isServerOnline) {
      setTimeout(initMinecraftBot, 30000);
    }
  });
  
  // Handle server events like rain, time changes, etc.
  mcBot.on('rain', () => {
    const channel = client.channels.cache.find(ch => ch.name === MC_CHAT_CHANNEL);
    if (channel) {
      channel.send(`🌧️ It started raining in the Minecraft world`);
    }
  });
  
  mcBot.on('noteHeard', (block, instrument, pitch) => {
    // Optional: Report noteblock activity
    console.log('Noteblock heard:', instrument, pitch);
  });
  
  // Entity detection for improved combat awareness
  mcBot.on('entitySpawn', (entity) => {
    if (!mcBot.entity || !autoAttackEnabled) return;
    
    try {
      // Check if it's a hostile mob within attack radius
      if (entity && entity.type && entity.position) {
        const isHostile = ['zombie', 'skeleton', 'spider', 'creeper', 'witch', 'enderman'].some(mobType => 
          entity.type.toLowerCase().includes(mobType)
        );
        
        if (isHostile && entity.position.distanceTo(mcBot.entity.position) <= autoAttackRadius) {
          console.log(`Detected new hostile entity: ${entity.type}`);
          
          // Don't attack if already attacking something
          if (!isAttacking) {
            attackMob(mcBot, entity);
          }
        }
      }
    } catch (error) {
      console.error('Entity detection error:', error);
    }
  });
  
  // Handle entity movement for better combat tracking
  mcBot.on('entityMoved', (entity) => {
    if (!mcBot.entity || !autoAttackEnabled || isAttacking) return;
    
    try {
      // Check if it's a hostile mob that moved into attack radius
      if (entity && entity.type && entity.position) {
        const isHostile = ['zombie', 'skeleton', 'spider', 'creeper', 'witch', 'enderman'].some(mobType => 
          entity.type.toLowerCase().includes(mobType)
        );
        
        if (isHostile && entity.position.distanceTo(mcBot.entity.position) <= autoAttackRadius) {
          // Only attack if not already attacking and mob is very close
          if (!isAttacking && entity.position.distanceTo(mcBot.entity.position) <= 3) {
            console.log(`Hostile entity moved close: ${entity.type}`);
            attackMob(mcBot, entity);
          }
        }
      }
    } catch (error) {
      console.error('Entity movement tracking error:', error);
    }
  });

  // Health check interval
  setInterval(() => {
    if (mcBot.entity) {
      lastHealthCheck = Date.now();
      isServerOnline = true;
    } else if (Date.now() - lastHealthCheck > 60000) {
      // If no health check for 1 minute, consider server offline
      isServerOnline = false;
      updateBotStatus();
    }
  }, 30000);
  
  // Auto-attack nearby hostile mobs
  setInterval(() => {
    if (!mcBot.entity || !autoAttackEnabled) return;
    
    try {
      // Don't interrupt if already attacking
      if (isAttacking) return;
      
      // Find nearby hostile mobs
      const hostileMobs = Object.values(mcBot.entities).filter(entity => {
        if (!entity || !entity.type) return false;
        
        const isHostile = ['zombie', 'skeleton', 'spider', 'creeper', 'witch', 'enderman'].some(mobType => 
          entity.type.toLowerCase().includes(mobType)
        );
        
        return isHostile && 
               entity.position.distanceTo(mcBot.entity.position) <= autoAttackRadius && 
               entity.type !== 'player';
      });
      
      // Attack nearest hostile mob if found
      if (hostileMobs.length > 0) {
        const nearestMob = hostileMobs.reduce((nearest, mob) => {
          const currentDistance = mob.position.distanceTo(mcBot.entity.position);
          const nearestDistance = nearest ? nearest.position.distanceTo(mcBot.entity.position) : Infinity;
          return currentDistance < nearestDistance ? mob : nearest;
        }, null);
        
        if (nearestMob) {
          console.log(`Auto-attacking nearby ${nearestMob.type}`);
          attackMob(mcBot, nearestMob);
        }
      }
    } catch (error) {
      console.error('Auto-attack error:', error);
    }
  }, 2000); // Check every 2 seconds
  
  // Update following behavior
  setInterval(() => {
    if (!mcBot.entity || !isFollowing || !followingPlayer) return;
    
    try {
      const player = mcBot.players[followingPlayer];
      if (!player || !player.entity) {
        isFollowing = false;
        followingPlayer = null;
        return;
      }
      
      // Update follow goal to keep following the player
      mcBot.pathfinder.setGoal(new GoalFollow(player.entity, 2));
    } catch (error) {
      console.error('Follow update error:', error);
      isFollowing = false;
      followingPlayer = null;
    }
  }, 3000); // Update follow target every 3 seconds

  return mcBot;
};

// Update Discord bot status based on Minecraft server status
function updateBotStatus() {
  // Check if client.user exists before trying to update status
  if (!client.user) {
    console.log('Discord client not fully initialized yet, skipping status update');
    return;
  }
  
  if (isServerOnline) {
    client.user.setActivity('Minecraft Server Online', { type: ActivityType.Watching });
    client.user.setStatus('online');
  } else {
    client.user.setActivity('Server Offline', { type: ActivityType.Watching });
    client.user.setStatus('dnd');
  }
}

// Helper function to attack a mob
function attackMob(bot, mob) {
  try {
    // Set tracking variables
    isAttacking = true;
    attackingMob = mob.id;
    
    // Clear any existing goals
    bot.pathfinder.setGoal(null);
    
    // Set up pathfinder to move to the mob
    const mcData = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    movements.canDig = false; // Don't dig in SMP
    bot.pathfinder.setMovements(movements);
    
    // Set goal to move near the mob
    const goal = new GoalNear(mob.position.x, mob.position.y, mob.position.z, 2);
    bot.pathfinder.setGoal(goal);
    
    // Look at and attack the mob
    bot.lookAt(mob.position);
    bot.attack(mob);
    
    // Reset attack state after a delay
    setTimeout(() => {
      isAttacking = false;
      attackingMob = null;
    }, 10000); // Reset after 10 seconds
    
    return true;
  } catch (error) {
    console.error('Attack mob error:', error);
    isAttacking = false;
    attackingMob = null;
    return false;
  }
}

// Discord bot event handlers
// Create HTTP server to handle incoming requests
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is alive!');
});

// Start the server
server.listen(process.env.PORT || 3000, () => {
  console.log(`HTTP server is running on port ${process.env.PORT || 3000}`);
});

// Function to ping the Render deployment
function pingServer() {
  https.get(RENDER_URL, (res) => {
    console.log('Ping successful, status:', res.statusCode);
  }).on('error', (err) => {
    console.error('Ping failed:', err.message);
  });
}

// Start periodic pinging
setInterval(pingServer, PING_INTERVAL);

client.on('ready', () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  client.user.setActivity('Starting up...', { type: ActivityType.Playing });
  
  // Initial ping
  pingServer();
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Handle tell command as it works in any channel
  if (message.content.startsWith('!mc tell')) {
    // Check if user has permission
    if (!AUTHORIZED_USER_IDS.includes(message.author.id)) {
      try {
        const errorMsg = await message.channel.send('⚠️ You do not have permission to use this command.');
        setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
      } catch (error) {
        console.error('Failed to send error message:', error);
      }
      return;
    }

    // Delete the command message immediately
    try {
      await message.delete();
    } catch (error) {
      console.error('Failed to delete message:', error);
    }

    const tellText = message.content.slice('!mc tell'.length).trim();
    if (!tellText) {
      try {
        const errorMsg = await message.channel.send('Please provide a message to send.');
        setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
      } catch (error) {
        console.error('Failed to send error message:', error);
      }
      return;
    }

    // Send the message to the Discord channel as an embed
    try {
      const tellEmbed = new EmbedBuilder()
        .setTitle('Oggy House Minecraft SMP')
        .setDescription(tellText)
        .setColor('#0099ff')
        .setTimestamp()
        .setFooter({ text: 'May your adventures be epic and your builds legendary! 🎮' });

      await message.channel.send({ embeds: [tellEmbed] });
    } catch (error) {
      console.error('Failed to send message to Discord:', error);
      const errorMsg = await message.channel.send('⚠️ Failed to send message.');
      setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
    }
    return;
  }

  // Only process commands in minecraft-chat channel except for tell and rules commands
  if (message.content.startsWith('!mc rules')) {
    // Handle rules command here
    const args = message.content.slice(3).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    if (command === 'rules') {
      // Check if user has permission
      if (!AUTHORIZED_USER_IDS.includes(message.author.id)) {
        try {
          const errorMsg = await message.channel.send('⚠️ You do not have permission to use this command.');
          setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
        } catch (error) {
          console.error('Failed to send error message:', error);
        }
        return;
      }

      // Delete the command message immediately
      try {
        await message.delete();
      } catch (error) {
        console.error('Failed to delete message:', error);
      }

      const rulesEmbed = new EmbedBuilder()
        .setTitle('📢 Server Rules & Guidelines – Please Read! 📢')
        .setColor('#ff6b6b')
        .setDescription('Hey <@&1260683185185095710>! 👋🏻\nWelcome to our smp! To keep everything fun, fair, and sustainable, we have a few important rules that all members must follow to stay in the community and enjoy gameplay. Please read carefully:\n\nDo NOT spam whitelist requests during live streams – Messages like "whitelist me" will be deleted. Repeated offenses may lead to a mute or ban. Be patient and respectful.')
        .addFields(
          {
            name: '💰 SERVER ACCESS FEE',
            value: 'This is a paid server with limited resources.\n\n'
              + 'Every member must pay ₹1 per day to maintain access.\n\n'
              + 'Payments can be made in advance (e.g., ₹30 for a month).\n\n'
              + 'Non-payment will result in a temporary suspension until dues are cleared.\n\n'
              + 'If you\'re unable to pay for any reason, please contact an admin before missing your payment.\n\n'
              + '⚠️ Please note: If you are banned from the server for breaking the rules, no refunds will be provided under any circumstances.'
          },
          {
            name: '🎮 IN-GAME RULES',
            value: 'No cheating or hacking – Use of third-party tools or exploits will result in an immediate ban.\n\n'
              + 'No griefing or trolling – Don\'t ruin others\' experience (e.g., stealing, destroying builds, baiting).\n\n'
              + 'No personal builds near spawn or the main SMP area – These are reserved for community use. Build your personal base at a reasonable distance.\n\n'
              + 'Play fair and team up respectfully – Collaborate, don\'t dominate.\n\n'
              + 'Use proper channels for voice/text – Stick to designated channels for in-game discussion, support, and off-topic chat.'
          },
          {
            name: '📢 IMPORTANT NOTES',
            value: 'Rule violations may result in a warning, mute, kick, or permanent ban, depending on severity.\n\n'
              + 'If you see someone breaking the rules, report it privately to a mod or admin.\n\n'
              + 'Let\'s keep this a friendly, safe, and fun community for everyone!\n\n'
              + '✅ By staying in this server, you agree to follow all rules, including the daily access fee and no-refund policy for bans.\n\n'
              + 'If you have any questions or need help with payment, whitelisting, or anything else, feel free to reach out to a mod or admin.\n\n'
              + 'Thanks for being here – and happy gaming! 🎮✨'
          }
        )
        .setTimestamp()
        .setFooter({ text: 'Oggy\'s House SMP' });

      message.channel.send({ embeds: [rulesEmbed] });
      return;
    }
  }

  // Only process other commands in minecraft-chat channel
  if (message.channel.name !== MC_CHAT_CHANNEL) {
    return;
  }

  // Only process commands starting with !mc
  if (!message.content.startsWith('!mc')) {
    return;
  }

  // Handle !mc say command first to ensure quick deletion
  if (message.content.startsWith('!mc say')) {
    // Delete the message immediately
    try {
      await message.delete();
    } catch (error) {
      console.error('Failed to delete message:', error);
    }
  }

  // Handle commands
  if (message.content.startsWith('!mc')) {
    const args = message.content.slice(3).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Check if bot is connected before executing commands
    if (!bot || !bot.entity) {
      if (command !== 'help') {
        return message.reply('⚠️ Not connected to Minecraft server. Try again later.');
      }
    }

    switch (command) {
      case 'status':
        const players = bot?.players || {};
        const playerCount = Object.keys(players).length;
        const onlinePlayers = Object.keys(players).join(', ') || 'No players online';
        
        const embed = new EmbedBuilder()
          .setTitle('Minecraft Server Status')
          .setColor(isServerOnline ? '#00ff00' : '#ff0000')
          .addFields(
            { name: 'Server', value: `Oggy's SMP Server` },
            { name: 'Status', value: isServerOnline ? '🟢 Online' : '🔴 Offline' },
            { name: `Players Online (${playerCount})`, value: onlinePlayers }
          )
          .setTimestamp();
        
        message.channel.send({ embeds: [embed] });
        break;

      case 'list':
        if (!bot || !bot.entity) return;
        const playersList = Object.keys(bot.players).map(name => {
          const player = bot.players[name];
          return `${name} - Ping: ${player.ping}ms`;
        }).join('\n') || 'No players online';
        
        const listEmbed = new EmbedBuilder()
          .setTitle('Online Players')
          .setDescription(playersList)
          .setColor('#00ff00')
          .setTimestamp();
        
        message.channel.send({ embeds: [listEmbed] });
        break;

      case 'say':
        // Check if user has permission
        if (!AUTHORIZED_USER_IDS.includes(message.author.id)) {
          try {
            const errorMsg = await message.channel.send('⚠️ You do not have permission to use this command.');
            setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          } catch (error) {
            console.error('Failed to send error message:', error);
          }
          return;
        }

        // Check if bot is connected
        if (!bot || !bot.entity) {
          try {
            const errorMsg = await message.channel.send('⚠️ Cannot send message: Bot is not connected to the server.');
            setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          } catch (error) {
            console.error('Failed to send error message:', error);
          }
          return;
        }
        
        // Get message text
        const text = args.join(' ');
        if (!text) {
          try {
            const errorMsg = await message.channel.send('Please provide a message to send.');
            setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          } catch (error) {
            console.error('Failed to send error message:', error);
          }
          return;
        }
        
        // Send message to Minecraft
        try {
          // Use bot.chat() to send the message in-game
          await bot.chat(text);
          
          // Wait a short moment to ensure message is sent
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Send confirmation to Discord
          const confirmMsg = await message.channel.send(`✅ Sent to Minecraft: ${text}`);
          setTimeout(() => confirmMsg.delete().catch(() => {}), 5000);
        } catch (error) {
          console.error('Failed to send message to Minecraft:', error);
          const errorMsg = await message.channel.send('⚠️ Failed to send message to Minecraft server.');
          setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
        }
        break;



      case 'cmd':
        // Admin command - check if user has admin role
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          return message.reply('You do not have permission to use this command.');
        }
        
        const command = args.join(' ');
        if (!command) return message.reply('Please provide a command to execute.');
        
        try {
          bot.chat(`/${command}`);
          message.react('✅');
        } catch (error) {
          message.reply(`Error executing command: ${error.message}`);
        }
        break;

      case 'time':
        if (!bot || !bot.entity) return;
        const time = bot.time.timeOfDay;
        const hours = Math.floor(time / 1000 + 6) % 24; // Convert to hours, Minecraft day starts at 6am
        const minutes = Math.floor((time % 1000) / 16.66); // Convert to minutes
        
        const timeEmbed = new EmbedBuilder()
          .setTitle('Minecraft Server Time')
          .setDescription(`Current time: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`)
          .setColor('#00ff00')
          .addFields(
            { name: 'Day/Night', value: (hours >= 6 && hours < 18) ? '☀️ Day' : '🌙 Night' }
          );
        
        message.channel.send({ embeds: [timeEmbed] });
        break;

      case 'weather':
        if (!bot || !bot.entity) return;
        const isRaining = bot.isRaining;
        const weatherEmbed = new EmbedBuilder()
          .setTitle('Minecraft Server Weather')
          .setDescription(`Current weather: ${isRaining ? '🌧️ Raining' : '☀️ Clear'}`)
          .setColor('#00ff00');
        
        message.channel.send({ embeds: [weatherEmbed] });
        break;

      case 'tp':
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          return message.reply('You do not have permission to use this command.');
        }
        
        if (args.length < 2) {
          return message.reply('Usage: !mc tp <player1> <player2>');
        }
        
        bot.chat(`/tp ${args[0]} ${args[1]}`);
        message.react('✅');
        break;

      case 'kick':
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          return message.reply('You do not have permission to use this command.');
        }
        
        if (args.length < 1) {
          return message.reply('Usage: !mc kick <player> [reason]');
        }
        
        const player = args[0];
        const reason = args.slice(1).join(' ') || 'Kicked by admin';
        bot.chat(`/kick ${player} ${reason}`);
        message.react('✅');
        break;

      case 'comehere':
        // Check if user has permission
        if (!AUTHORIZED_USER_IDS.includes(message.author.id)) {
          try {
            const errorMsg = await message.channel.send('⚠️ You do not have permission to use this command.');
            setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          } catch (error) {
            console.error('Failed to send error message:', error);
          }
          return;
        }

        if (!args[0]) {
          return message.reply('Please specify a player to teleport to. Usage: !mc comehere <player>');
        }

        // Check if the player exists in the game
        const playerNameToTeleport = args[0];
const targetPlayerToTeleport = Object.values(bot.players).find(p => p.username.toLowerCase() === playerNameToTeleport.toLowerCase());

if (!targetPlayerToTeleport) {
  return message.reply(`Player ${playerNameToTeleport} is not online.`);
}

if (!targetPlayerToTeleport.entity) {
  return message.reply(`Cannot locate ${playerNameToTeleport}'s position. They might be too far away.`);
}

// Send initial response
message.channel.send(`✅ Moving to ${playerNameToTeleport}'s location...`);

// Store the target position
const targetPosition = targetPlayerToTeleport.entity.position.clone();

try {
  // Safety check - ensure bot entity exists
  if (!bot.entity) {
    return message.reply('❌ Bot is not properly initialized. Please try again later.');
  }
  
  // Clear any existing goals and stop any current pathfinding
  bot.pathfinder.setGoal(null);
  
  // Get the current mcData and set up movements with safe values
  const mcData = require('minecraft-data')(bot.version);
  const movements = new Movements(bot, mcData);
  
  // Configure movements for safety
  movements.canDig = false; // Don't dig in SMP
  movements.allowSprinting = true;
  movements.maxDropDown = 3; // Safer drop distance
  movements.blocksCantBreak = new Set(); // Don't break any blocks
  
  // Apply the movements configuration
  bot.pathfinder.setMovements(movements);
  
  // Set goal to move near the player with a reasonable distance
  const goal = new GoalNear(targetPosition.x, targetPosition.y, targetPosition.z, 2);
  
  // Create a timeout to prevent infinite pathfinding
  let pathfindingTimeout;
  let isCompleted = false;
  
  // Set up pathfinding error handler
  const onPathingError = (err) => {
    console.error('Pathfinding error:', err);
    if (!isCompleted) {
      isCompleted = true;
      clearTimeout(pathfindingTimeout);
      message.channel.send(`❌ Error while navigating to ${playerNameToTeleport}: ${err.message}`);
    }
  };
  
  // Set up pathfinding completion handler
  const onPathingComplete = () => {
    if (!isCompleted) {
      isCompleted = true;
      clearTimeout(pathfindingTimeout);
      
      // Check if we actually reached the destination
      if (bot.entity && bot.entity.position.distanceTo(targetPosition) <= 4) {
        message.channel.send(`✅ Successfully reached ${playerNameToTeleport}'s location.`);
      } else {
        message.channel.send(`⚠️ Got as close as possible to ${playerNameToTeleport}, but couldn't reach the exact location.`);
      }
    }
  };
  
  // Set up timeout to prevent infinite pathfinding
  pathfindingTimeout = setTimeout(() => {
    if (!isCompleted) {
      isCompleted = true;
      bot.pathfinder.setGoal(null); // Stop pathfinding
      message.channel.send(`⚠️ Taking too long to reach ${playerNameToTeleport}. Stopping navigation.`);
    }
  }, 30000); // 30 second timeout
  
  // Start pathfinding with error handling
  bot.pathfinder.goto(goal).then(onPathingComplete).catch(onPathingError);
  
} catch (error) {
  console.error('Pathfinding setup error:', error);
  message.channel.send(`❌ Error setting up navigation: ${error.message}`);
}
break;

case 'follow':
  if (!args[0]) {
    return message.reply('Please specify a player to follow. Usage: !mc follow <player>');
  }
  
  try {
    const playerNameToFollow = args[0];
    const targetPlayerToFollow = bot.players[playerNameToFollow];
    if (!targetPlayerToFollow || !targetPlayerToFollow.entity) {
      return message.reply(`Cannot locate ${playerNameToFollow}'s position. They might be too far away or not online.`);
    }
    
    // Clear any existing goals
    bot.pathfinder.setGoal(null);
    
    // Set up pathfinder movements
    const mcData = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    movements.canDig = false; // Don't dig in SMP
    bot.pathfinder.setMovements(movements);
    
    // Set follow goal
    bot.pathfinder.setGoal(new GoalFollow(targetPlayerToFollow.entity, 2));
    
    // Update tracking variables
    isFollowing = true;
    followingPlayer = playerNameToFollow;
    
    message.reply(`✅ Now following ${playerNameToFollow}`);
  } catch (error) {
    console.error('Follow error:', error);
    message.reply(`❌ Error following player: ${error.message}`);
    isFollowing = false;
    followingPlayer = null;
  }
  break;

case 'stopfollow':
  try {
    // Clear follow goal
    bot.pathfinder.setGoal(null);
    isFollowing = false;
    followingPlayer = null;
    message.reply('✅ Stopped following player');
  } catch (error) {
    console.error('Stop follow error:', error);
    message.reply(`❌ Error stopping follow: ${error.message}`);
  }
  break;

      case 'comehere':
        // Check if user has permission
        if (!AUTHORIZED_USER_IDS.includes(message.author.id)) {
          try {
            const errorMsg = await message.channel.send('⚠️ You do not have permission to use this command.');
            setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          } catch (error) {
            console.error('Failed to send error message:', error);
          }
          return;
        }

        if (!args[0]) {
          return message.reply('Please specify a player to teleport to. Usage: !mc comehere <player>');
        }

        const playerToTeleport = bot.players[args[0]];
        if (!playerToTeleport || !playerToTeleport.entity) {
          return message.reply(`Cannot locate ${args[0]}'s position. They might be too far away or not online.`);
        }

        bot.chat(`/tp ${args[0]} ${bot.username}`);
        message.react('✅');
        break;

      case 'setviewdistance':
        if (!args[0]) {
          return message.reply('Please specify a view distance. Usage: !mc setviewdistance <distance>');
        }

        const viewDistance = parseInt(args[0], 10);
        if (isNaN(viewDistance) || viewDistance < 2 || viewDistance > 32) {
          return message.reply('Invalid view distance. Please specify a number between 2 and 32.');
        }

        try {
          bot.settings.viewDistance = viewDistance;
          message.react('✅');
        } catch (error) {
          console.error('Failed to set view distance:', error);
          message.reply(`❌ Error setting view distance: ${error.message}`);
        }
        break;

      case 'attack':
        // Check if user has permission
        if (!['724265072364617759', '975806223582642196'].includes(message.author.id)) {
          try {
            const errorMsg = await message.channel.send('⚠️ You do not have permission to use this command.');
            setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          } catch (error) {
            console.error('Failed to send error message:', error);
          }
          return;
        }

        if (!args[0]) {
          return message.reply('Please specify a mob type to attack. Usage: !mc attack <mob> (e.g., zombie, skeleton, spider)');
        }

        try {
          // Get all entities and find mobs that match the requested type
          const mobType = args[0].toLowerCase();
          const entities = Object.values(bot.entities);
          
          // Log available entity types for debugging
          const entityTypes = [...new Set(entities.map(e => e.type?.toLowerCase()).filter(Boolean))];
          console.log('Available entity types:', entityTypes);
          
          // Create a more flexible filter that checks if the entity type contains the requested mob name
          const mobFilter = e => {
            if (!e || !e.type) return false;
            const entityType = e.type.toLowerCase();
            return entityType.includes(mobType) && 
                   e.position.distanceTo(bot.entity.position) < 32 && // Increased range
                   e.type !== 'player'; // Don't attack players
          };
          
          const mob = bot.nearestEntity(mobFilter);
          
          if (!mob) {
            return message.reply(`No ${args[0]} found nearby. Available mobs: ${entityTypes.join(', ')}`);
          }

          // Attack the mob using the helper function
          attackMob(bot, mob);
          
          message.reply(`✅ Moving to and attacking ${mob.type} (ID: ${mob.id})`);
        } catch (error) {
          console.error('Attack error:', error);
          message.reply(`❌ Error attacking mob: ${error.message}`);
        }
        break;
        
      case 'autoattack':
        // Check if user has permission
        if (!['724265072364617759', '975806223582642196'].includes(message.author.id)) {
          try {
            const errorMsg = await message.channel.send('⚠️ You do not have permission to use this command.');
            setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          } catch (error) {
            console.error('Failed to send error message:', error);
          }
          return;
        }
        
        // Toggle auto-attack mode
        if (args[0] === 'on') {
          autoAttackEnabled = true;
          // Set radius if provided
          if (args[1] && !isNaN(parseInt(args[1]))) {
            autoAttackRadius = parseInt(args[1]);
          }
          message.reply(`✅ Auto-attack enabled with radius ${autoAttackRadius} blocks`);
        } else if (args[0] === 'off') {
          autoAttackEnabled = false;
          message.reply('✅ Auto-attack disabled');
        } else {
          message.reply('Usage: !mc autoattack <on|off> [radius]');
        }
        break;

      case 'comehere':
        // Check if user has permission
        if (!AUTHORIZED_USER_IDS.includes(message.author.id)) {
          try {
            const errorMsg = await message.channel.send('⚠️ You do not have permission to use this command.');
            setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          } catch (error) {
            console.error('Failed to send error message:', error);
          }
          return;
        }

        // Find the player by Discord username or by specified username
        let playerUsername = message.author.username;
        if (args[0]) {
          playerUsername = args[0];
        }
        
        // Look for the player in the game
        const availablePlayers = Object.keys(bot.players);
        const closestMatch = availablePlayers.find(name => 
          name.toLowerCase() === playerUsername.toLowerCase() ||
          name.toLowerCase().includes(playerUsername.toLowerCase())
        );
        
        if (!closestMatch) {
          return message.reply(`Could not find player matching "${playerUsername}" in the game. Available players: ${availablePlayers.join(', ')}`);
        }
        
        const caller = bot.players[closestMatch];
        if (!caller || !caller.entity) {
          return message.reply(`Player ${closestMatch} is in the game but not in visible range. They need to be nearby.`);
        }

        // Send initial response
        message.reply(`✅ Coming to ${closestMatch}'s location`);

        // Store the target position
        const targetPos = caller.entity.position.clone();
        
        try {
          // Safety check - ensure bot entity exists
          if (!bot.entity) {
            return message.reply('❌ Bot is not properly initialized. Please try again later.');
          }
          
          // Clear any existing goals and stop any current pathfinding
          bot.pathfinder.setGoal(null);
          
          // Get the current mcData and set up movements with safe values
          const mcData = require('minecraft-data')(bot.version);
          const movements = new Movements(bot, mcData);
          
          // Configure movements for safety
          movements.canDig = false; // Don't dig in SMP
          movements.allowSprinting = true;
          movements.maxDropDown = 3; // Safer drop distance
          movements.blocksCantBreak = new Set(); // Don't break any blocks
          
          // Apply the movements configuration
          bot.pathfinder.setMovements(movements);
          
          // Set goal to move near the player with a reasonable distance
          const goal = new GoalNear(targetPos.x, targetPos.y, targetPos.z, 2);
          
          // Create a timeout to prevent infinite pathfinding
          let pathfindingTimeout;
          let isCompleted = false;
          
          // Set up pathfinding error handler
          const onPathingError = (err) => {
            console.error('Pathfinding error:', err);
            if (!isCompleted) {
              isCompleted = true;
              clearTimeout(pathfindingTimeout);
              message.channel.send(`❌ Error while navigating to ${closestMatch}: ${err.message}`);
            }
          };
          
          // Set up pathfinding completion handler
          const onPathingComplete = () => {
            if (!isCompleted) {
              isCompleted = true;
              clearTimeout(pathfindingTimeout);
              
              // Check if we actually reached the destination
              if (bot.entity && bot.entity.position.distanceTo(targetPos) <= 4) {
                message.channel.send(`✅ Successfully reached ${closestMatch}'s location.`);
              } else {
                message.channel.send(`⚠️ Got as close as possible to ${closestMatch}, but couldn't reach the exact location.`);
              }
            }
          };
          
          // Set up timeout to prevent infinite pathfinding
          pathfindingTimeout = setTimeout(() => {
            if (!isCompleted) {
              isCompleted = true;
              bot.pathfinder.setGoal(null); // Stop pathfinding
              message.channel.send(`⚠️ Taking too long to reach ${closestMatch}. Stopping navigation.`);
            }
          }, 30000); // 30 second timeout
          
          // Start pathfinding with error handling
          bot.pathfinder.goto(goal).then(onPathingComplete).catch(onPathingError);
          
        } catch (error) {
          console.error('Pathfinding setup error:', error);
          message.reply(`❌ Error setting up navigation: ${error.message}`);
        }
        break;

      case 'restart':
        if (!message.member.permissions.has('ADMINISTRATOR')) {
          return message.reply('You do not have permission to use this command.');
        }
        
        message.channel.send('🔄 Attempting to reconnect to the Minecraft server...');
        
        if (bot) {
          bot.quit();
        }
        
        setTimeout(() => {
          bot = initMinecraftBot();
          message.channel.send('✅ Reconnection attempt initiated.');
        }, 5000);
        break;

      case 'disconnect':
        // Check if user has permission
        if (!['724265072364617759', '975806223582642196'].includes(message.author.id)) {
          try {
            const errorMsg = await message.channel.send('⚠️ You do not have permission to use this command.');
            setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          } catch (error) {
            console.error('Failed to send error message:', error);
          }
          return;
        }
        
        if (!bot || !bot.entity) {
          return message.reply('⚠️ Bot is already disconnected from the server.');
        }
        
        try {
          // Send initial message
          await message.channel.send('🔌 Disconnecting from the Minecraft server...');
          
          // Quit the bot
          bot.quit();
          isServerOnline = false;
          updateBotStatus();
          
          // Send confirmation message
          await message.channel.send('✅ Successfully disconnected. Use !mc restart to reconnect.');
        } catch (error) {
          console.error('Error during disconnect:', error);
          await message.channel.send('⚠️ Error occurred while disconnecting. Please try again.');
        }
        break;
console.log('Disconnecting from the Minecraft server...');
        bot.quit();
        isServerOnline = false;
        updateBotStatus();
        message.channel.send('✅ Successfully disconnected. Use `!mc restart` to reconnect.');
        break;

      case 'rules':
        // Check if user has permission
        if (!['724265072364617759', '975806223582642196'].includes(message.author.id)) {
          try {
            const errorMsg = await message.channel.send('⚠️ You do not have permission to use this command.');
            setTimeout(() => errorMsg.delete().catch(() => {}), 5000);
          } catch (error) {
            console.error('Failed to send error message:', error);
          }
          return;
        }

        // Delete the command message immediately
        try {
          await message.delete();
        } catch (error) {
          console.error('Failed to delete message:', error);
        }

        const rulesEmbed = new EmbedBuilder()
          .setTitle('📢 Server Rules & Guidelines – Please Read! 📢')
          .setColor('#ff6b6b')
          .setDescription('Hey @Cockroach Party! 👋🏻\nWelcome to our smp! To keep everything fun, fair, and sustainable, we have a few important rules that all members must follow to stay in the community and enjoy gameplay. Please read carefully:\n\nDo NOT spam whitelist requests during live streams – Messages like "whitelist me" will be deleted. Repeated offenses may lead to a mute or ban. Be patient and respectful.')
          .addFields(
            {
              name: '💰 SERVER ACCESS FEE',
              value: 'This is a paid server with limited resources.\n\n'
                + 'Every member must pay ₹1 per day to maintain access.\n\n'
                + 'Payments can be made in advance (e.g., ₹30 for a month).\n\n'
                + 'Non-payment will result in a temporary suspension until dues are cleared.\n\n'
                + 'If you\'re unable to pay for any reason, please contact an admin before missing your payment.\n\n'
                + '⚠️ Please note: If you are banned from the server for breaking the rules, no refunds will be provided under any circumstances.'
            },
            {
              name: '🎮 IN-GAME RULES',
              value: 'No cheating or hacking – Use of third-party tools or exploits will result in an immediate ban.\n\n'
                + 'No griefing or trolling – Don\'t ruin others\' experience (e.g., stealing, destroying builds, baiting).\n\n'
                + 'No personal builds near spawn or the main SMP area – These are reserved for community use. Build your personal base at a reasonable distance.\n\n'
                + 'Play fair and team up respectfully – Collaborate, don\'t dominate.\n\n'
                + 'Use proper channels for voice/text – Stick to designated channels for in-game discussion, support, and off-topic chat.'
            },
            {
              name: '📢 IMPORTANT NOTES',
              value: 'Rule violations may result in a warning, mute, kick, or permanent ban, depending on severity.\n\n'
                + 'If you see someone breaking the rules, report it privately to a mod or admin.\n\n'
                + 'Let\'s keep this a friendly, safe, and fun community for everyone!\n\n'
                + '✅ By staying in this server, you agree to follow all rules, including the daily access fee and no-refund policy for bans.\n\n'
                + 'If you have any questions or need help with payment, whitelisting, or anything else, feel free to reach out to a mod or admin.\n\n'
                + 'Thanks for being here – and happy gaming! 🎮✨ @everyone @here @Minecraft'
            }
          )
          .setTimestamp()
          .setFooter({ text: 'Oggy\'s House SMP' });

        message.channel.send({ embeds: [rulesEmbed] });
        break;

      case 'help':
      default:
        const helpEmbed = new EmbedBuilder()
          .setTitle('Minecraft Discord Bot Commands')
          .setColor('#0099ff')
          .setDescription('Available commands:')
          .addFields(
            { name: '!mc status', value: 'Show server status and online players' },
            { name: '!mc list', value: 'Show detailed list of online players' },
            { name: '!mc say <message>', value: 'Send a message to the Minecraft server' },
            { name: '!mc tell <message>', value: 'Send a message to the Discord channel (Restricted)' },
            { name: '!mc time', value: 'Show the current time in the Minecraft world' },
            { name: '!mc weather', value: 'Show the current weather in the Minecraft world' },
            { name: '!mc help', value: 'Show this help message' },
            { name: '!mc rules', value: 'Display server rules and guidelines (Restricted)' }
            
          )
          .addFields({
            name: 'Admin Commands',
            value: '!mc cmd <command> - Execute a command on the server\n!mc tp <player1> <player2> - Teleport player1 to player2\n!mc kick <player> [reason] - Kick a player\n!mc restart - Restart the bot connection'
          })
          .setFooter({ text: 'Oggy\'s House SMP' });
        
        message.channel.send({ embeds: [helpEmbed] });
        break;
    }
  }
});

// Initialize bots
bot = initMinecraftBot();

// Login to Discord
client.login(process.env.DISCORD_TOKEN).then(() => {
  console.log('Discord bot initialized and ready to relay messages');
}).catch(err => {
  console.error('Failed to login to Discord:', err);
});