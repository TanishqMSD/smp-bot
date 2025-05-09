require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const mineflayer = require('mineflayer');

// Configuration constants
const MC_CHAT_CHANNEL = 'minecraft-chat';
let lastHealthCheck = Date.now();
let isServerOnline = false;

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Bot instance
let bot;

// Initialize Minecraft bot
const initMinecraftBot = () => {
  console.log('Attempting to connect to Minecraft server...');
  
  const mcBot = mineflayer.createBot({
    host: process.env.MC_HOST || 'in02.servoid.pro',
    port: parseInt(process.env.MC_PORT || '8641'),
    username: process.env.MC_USERNAME,
    password: process.env.MC_PASSWORD,
    auth: process.env.MC_AUTH || 'microsoft',
    version: process.env.MC_VERSION || false
  });

  // Minecraft bot event handlers
  mcBot.on('spawn', () => {
    console.log('Minecraft bot connected to server');
    isServerOnline = true;
    updateBotStatus();
    
    // Send server online message to Discord
    const channel = client.channels.cache.find(ch => ch.name === MC_CHAT_CHANNEL);
    if (channel) {
      const embed = new EmbedBuilder()
        .setTitle('Server Connection Established')
        .setDescription(`Connected to ${process.env.MC_HOST || 'in02.servoid.pro'}:${process.env.MC_PORT || '8641'}`)
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
    const channel = client.channels.cache.find(ch => ch.name === MC_CHAT_CHANNEL);
    if (channel) {
      channel.send(`🟢 **${player.username}** joined the game`);
    }
  });

  mcBot.on('playerLeft', (player) => {
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

  return mcBot;
};

// Update Discord bot status based on Minecraft server status
function updateBotStatus() {
  if (isServerOnline) {
    client.user.setActivity('Minecraft Server Online', { type: ActivityType.Watching });
    client.user.setStatus('online');
  } else {
    client.user.setActivity('Server Offline', { type: ActivityType.Watching });
    client.user.setStatus('dnd');
  }
}

// Discord bot event handlers
client.on('ready', () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  client.user.setActivity('Starting up...', { type: ActivityType.Playing });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Get the Minecraft chat channel
  const minecraftChannel = client.channels.cache.find(ch => ch.name === MC_CHAT_CHANNEL);
  
  // Forward Discord messages to Minecraft (if in the minecraft-chat channel)
  if (message.channel.name === MC_CHAT_CHANNEL && !message.content.startsWith('!mc')) {
    if (bot && bot.entity) {
      bot.chat(`[Discord] ${message.author.username}: ${message.content}`);
    }
    return;
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
        const playerList = Object.keys(players).join(', ') || 'No players online';
        
        const embed = new EmbedBuilder()
          .setTitle('Minecraft Server Status')
          .setColor(isServerOnline ? '#00ff00' : '#ff0000')
          .addFields(
            { name: 'Server', value: `${process.env.MC_HOST || 'in02.servoid.pro'}:${process.env.MC_PORT || '8641'}` },
            { name: 'Status', value: isServerOnline ? '🟢 Online' : '🔴 Offline' },
            { name: `Players Online (${playerCount})`, value: playerList }
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
        if (!bot || !bot.entity) return;
        const text = args.join(' ');
        if (!text) return message.reply('Please provide a message to send.');
        
        bot.chat(text);
        message.react('✅');
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
            { name: '!mc time', value: 'Show the current time in the Minecraft world' },
            { name: '!mc weather', value: 'Show the current weather in the Minecraft world' },
            { name: '!mc help', value: 'Show this help message' }
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