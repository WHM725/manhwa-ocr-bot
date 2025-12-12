import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import dotenv from 'dotenv';
import { processManhwa } from './core';

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
// Parse keys from comma-separated string
const KEYS_STRING = process.env.GEMINI_API_KEYS || "";
const GEMINI_KEYS = KEYS_STRING.split(',').map(k => k.trim()).filter(k => k.length > 0);

if (!TOKEN || !CLIENT_ID || GEMINI_KEYS.length === 0) {
  console.error("❌ ERROR: Missing credentials in .env");
  console.error("Ensure GEMINI_API_KEYS has at least one key.");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('ocr')
    .setDescription('Extract text from Manhwa')
    .addAttachmentOption(o => o.setName('image').setDescription('The file').setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`✅ Bot Loaded. Using pool of ${GEMINI_KEYS.length} API Keys.`);
  } catch (error) { console.error(error); }
})();

client.on('ready', () => console.log(`🤖 Online as ${client.user?.tag}`));

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'ocr') {
    const attachment = interaction.options.getAttachment('image');
    if (!attachment || !attachment.contentType?.startsWith('image/')) {
      await interaction.reply({ content: '❌ Invalid file.', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    try {
      const result = await processManhwa(attachment.url, GEMINI_KEYS);
      if (!result.trim()) { await interaction.editReply('⚠️ No text found.'); return; }
      
      const file = new AttachmentBuilder(Buffer.from(result, 'utf-8'), { name: `${attachment.name}.txt` });
      await interaction.editReply({ content: `✅ Analysis Complete!`, files: [file] });

    } catch (error) {
      console.error(error);
      await interaction.editReply('❌ System Error.');
    }
  }
});

client.login(TOKEN);