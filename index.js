require('dotenv').config();
const fs = require('fs');
const path = require('path');

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  Events
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

const tickets = new Map();

const counterFilePath = path.join(__dirname, 'ticketCounter.json');

function ensureCounterFile() {
  if (!fs.existsSync(counterFilePath)) {
    fs.writeFileSync(counterFilePath, JSON.stringify({ lastTicketNumber: 0 }, null, 2));
  }
}

function getNextTicketNumber() {
  ensureCounterFile();

  const data = JSON.parse(fs.readFileSync(counterFilePath, 'utf8'));
  data.lastTicketNumber += 1;

  fs.writeFileSync(counterFilePath, JSON.stringify(data, null, 2));

  return data.lastTicketNumber;
}

function formatTicketNumber(number) {
  return String(number).padStart(4, '0');
}

function formatDate(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Bishkek',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

function safeFieldValue(value, fallback = 'Не указано') {
  if (!value || !value.trim()) return fallback;
  return value.length > 1024 ? value.slice(0, 1021) + '...' : value;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('setup_complaints')
      .setDescription('Отправить панель жалоб в канал')
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
      .toJSON()
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
}

client.once(Events.ClientReady, async () => {
  console.log(`Бот запущен как ${client.user.tag}`);
  ensureCounterFile();

  try {
    await registerCommands();
    console.log('Команды зарегистрированы');
  } catch (error) {
    console.error('Ошибка регистрации команд:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup_complaints') {
        const embed = new EmbedBuilder()
          .setTitle('Система жалоб')
          .setDescription('Нажмите кнопку ниже, чтобы подать жалобу анонимно.')
          .setColor(0xff9900);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('complaint_open')
            .setLabel('Подать жалобу')
            .setStyle(ButtonStyle.Danger)
        );

        const panelChannel = await client.channels.fetch(process.env.PANEL_CHANNEL_ID).catch(() => null);

        if (!panelChannel) {
          return interaction.reply({
            content: 'Не удалось найти PANEL_CHANNEL_ID. Проверь .env',
            ephemeral: true
          });
        }

        await panelChannel.send({
          embeds: [embed],
          components: [row]
        });

        await interaction.reply({
          content: 'Панель жалоб отправлена.',
          ephemeral: true
        });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'complaint_open') {
        const modal = new ModalBuilder()
          .setCustomId('complaint_modal')
          .setTitle('Подача жалобы');

        const targetInput = new TextInputBuilder()
          .setCustomId('complaint_target')
          .setLabel('На кого жалоба')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder('Ник или ID');

        const typeInput = new TextInputBuilder()
          .setCustomId('complaint_type')
          .setLabel('Тип жалобы')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30)
          .setPlaceholder('player или staff');

        const textInput = new TextInputBuilder()
          .setCustomId('complaint_text')
          .setLabel('Текст жалобы')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setPlaceholder('Опиши проблему подробно');

        const proofInput = new TextInputBuilder()
          .setCustomId('complaint_proof')
          .setLabel('Доказательства')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setPlaceholder('Ссылка, скрин, видео или описание');

        modal.addComponents(
          new ActionRowBuilder().addComponents(targetInput),
          new ActionRowBuilder().addComponents(typeInput),
          new ActionRowBuilder().addComponents(textInput),
          new ActionRowBuilder().addComponents(proofInput)
        );

        await interaction.showModal(modal);
      }

      if (interaction.customId === 'complaint_close') {
        const channelId = interaction.channel.id;
        const ticketData = tickets.get(channelId);

        if (!ticketData) {
          return interaction.reply({
            content: 'Данные тикета не найдены.',
            ephemeral: true
          });
        }

        const hasStaffRole = interaction.member.roles.cache.has(process.env.STAFF_ROLE_ID);
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

        if (!hasStaffRole && !isAdmin) {
          return interaction.reply({
            content: 'У тебя нет прав для закрытия жалобы.',
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(`close_modal_${channelId}`)
          .setTitle('Закрытие жалобы');

        const verdictInput = new TextInputBuilder()
          .setCustomId('complaint_verdict')
          .setLabel('Вердикт')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setPlaceholder('Например: жалоба принята, выдан мут на 3 дня');

        modal.addComponents(
          new ActionRowBuilder().addComponents(verdictInput)
        );

        await interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'complaint_modal') {
        const target = interaction.fields.getTextInputValue('complaint_target');
        const complaintType = interaction.fields.getTextInputValue('complaint_type');
        const complaintText = interaction.fields.getTextInputValue('complaint_text');
        const complaintProof = interaction.fields.getTextInputValue('complaint_proof') || 'Не указано';

        const guild = interaction.guild;
        const nextNumber = getNextTicketNumber();
        const formattedNumber = formatTicketNumber(nextNumber);

        const ticketChannel = await guild.channels.create({
          name: `жалоба-${formattedNumber}`,
          type: ChannelType.GuildText,
          parent: process.env.TICKET_CATEGORY_ID,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionsBitField.Flags.ViewChannel]
            },
            {
              id: process.env.STAFF_ROLE_ID,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
              ]
            },
            {
              id: client.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ReadMessageHistory
              ]
            }
          ]
        });

        tickets.set(ticketChannel.id, {
          ticketNumber: formattedNumber,
          authorId: interaction.user.id,
          authorTag: interaction.user.tag,
          target,
          complaintType,
          complaintText,
          complaintProof,
          createdAt: new Date()
        });

        const embed = new EmbedBuilder()
          .setTitle(`Новая анонимная жалоба #${formattedNumber}`)
          .setColor(0xff0000)
          .addFields(
            { name: 'Номер жалобы', value: `#${formattedNumber}`, inline: true },
            { name: 'Заявитель', value: 'Анонимно', inline: true },
            { name: 'Тип жалобы', value: safeFieldValue(complaintType), inline: true },
            { name: 'На кого жалоба', value: safeFieldValue(target), inline: true },
            { name: 'Текст жалобы', value: safeFieldValue(complaintText) },
            { name: 'Доказательства', value: safeFieldValue(complaintProof) }
          )
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('complaint_close')
            .setLabel('Закрыть с вердиктом')
            .setStyle(ButtonStyle.Success)
        );

        await ticketChannel.send({
          content: `<@&${process.env.STAFF_ROLE_ID}>`,
          embeds: [embed],
          components: [row]
        });

        await interaction.reply({
          content: `Твоя жалоба отправлена анонимно. Номер: #${formattedNumber}`,
          ephemeral: true
        });
      }

      if (interaction.customId.startsWith('close_modal_')) {
        const channelId = interaction.customId.replace('close_modal_', '');
        const ticketData = tickets.get(channelId);

        if (!ticketData) {
          return interaction.reply({
            content: 'Данные тикета не найдены.',
            ephemeral: true
          });
        }

        const verdict = interaction.fields.getTextInputValue('complaint_verdict');
        const closedAt = new Date();

        const logChannel = await client.channels.fetch(process.env.LOG_CHANNEL_ID).catch(() => null);

        if (!logChannel) {
          return interaction.reply({
            content: 'Не удалось найти LOG_CHANNEL_ID. Проверь .env',
            ephemeral: true
          });
        }

        const logEmbed = new EmbedBuilder()
          .setTitle(`Жалоба закрыта #${ticketData.ticketNumber}`)
          .setColor(0x00bfff)
          .addFields(
            {
              name: 'Номер жалобы',
              value: `#${ticketData.ticketNumber}`,
              inline: true
            },
            {
              name: 'Закрыл администратор',
              value: safeFieldValue(`${interaction.user.tag} (${interaction.user.id})`)
            },
            {
              name: 'Заявитель',
              value: 'Анонимно'
            },
            {
              name: 'Тип жалобы',
              value: safeFieldValue(ticketData.complaintType)
            },
            {
              name: 'На кого жалоба',
              value: safeFieldValue(ticketData.target)
            },
            {
              name: 'Текст жалобы',
              value: safeFieldValue(ticketData.complaintText)
            },
            {
              name: 'Доказательства',
              value: safeFieldValue(ticketData.complaintProof)
            },
            {
              name: 'Вердикт',
              value: safeFieldValue(verdict)
            },
            {
              name: 'Дата и время закрытия',
              value: formatDate(closedAt)
            }
          )
          .setFooter({ text: `Канал тикета: ${channelId}` })
          .setTimestamp(closedAt);

        await logChannel.send({
          embeds: [logEmbed]
        });

        await interaction.reply({
          content: `Жалоба #${ticketData.ticketNumber} закрыта, лог отправлен.`,
          ephemeral: true
        });

        const ticketChannel = await client.channels.fetch(channelId).catch(() => null);
        tickets.delete(channelId);

        if (ticketChannel) {
          setTimeout(async () => {
            await ticketChannel.delete().catch(() => {});
          }, 3000);
        }
      }
    }
  } catch (error) {
    console.error(error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Произошла ошибка при выполнении действия.',
        ephemeral: true
      }).catch(() => {});
    }
  }
});
client.login(process.env.TOKEN);