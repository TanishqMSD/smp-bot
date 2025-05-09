# Minecraft-Discord Integration Bot

This bot provides two-way communication between your Minecraft server and Discord without spawning an in-game bot. It relays chat messages, player join/leave events, and other server information between Discord and Minecraft.

## Features

- **Two-way Chat**: Messages from Minecraft are sent to Discord and vice versa
- **Player Events**: Join/leave notifications in Discord
- **Server Status**: Check who's online and server status from Discord
- **Admin Commands**: Manage your server from Discord
- **Weather & Time**: Get information about the Minecraft world

## Setup

1. **Prerequisites**:
   - Node.js installed on your system
   - A Discord bot token (create one at [Discord Developer Portal](https://discord.com/developers/applications))
   - Microsoft account with Minecraft ownership

2. **Configuration**:
   - Edit the `.env` file with your credentials:
   ```
   # Discord Bot Token
   DISCORD_TOKEN=your_discord_bot_token_here

   # Minecraft Server Configuration
   MC_HOST=in02.servoid.pro
   MC_PORT=8641
   MC_USERNAME=your_minecraft_username
   MC_PASSWORD=your_minecraft_password
   MC_AUTH=microsoft
   ```

3. **Discord Setup**:
   - Create a channel named `minecraft-chat` in your Discord server
   - Invite your bot to your Discord server

4. **Installation**:
   ```bash
   npm install
   npm start
   ```

## Usage

### Discord Commands

- `!mc status` - Show server status and online players
- `!mc say <message>` - Send a message to the Minecraft server
- `!mc list` - List all online players with details
- `!mc time` - Show the current time in the Minecraft world
- `!mc weather` - Show the current weather in the Minecraft world
- `!mc help` - Show help message

### Admin Commands

- `!mc kick <player>` - Kick a player from the server
- `!mc restart` - Restart the Minecraft connection
- `!mc command <command>` - Run a command on the Minecraft server

### Chat Integration

Any message sent in the `minecraft-chat` Discord channel will be forwarded to the Minecraft server, prefixed with `[Discord] Username: `. Messages from Minecraft will appear in the Discord channel.

## Troubleshooting

- If the bot disconnects, it will automatically attempt to reconnect every 30 seconds
- Check the console output for error messages
- Make sure your Microsoft account credentials are correct
- Ensure your Discord bot has the necessary permissions

## License

This project is open source and available under the MIT License.