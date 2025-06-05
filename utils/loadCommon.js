const fs = require('fs').promises;
const path = require('path');
const { createSticker } = require('wa-sticker-formatter');
const { yts } = require('yt-search');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const commands = { admins: {}, members: {}, owner: {} };

async function loadCommands() {
  const categories = ['admins', 'members', 'owner'];
  for (const category of categories) {
    const files = await fs.readdir(path.join(__dirname, `../commands/${category}`));
    for (const file of files) {
      if (file.endsWith('.js')) {
        const command = require(`../commands/${category}/${file}`);
        commands[category][command.name] = command;
      }
    }
  }
}

async function handleMessage(sock, messages, botNumber, groupSettings, ownerNumber) {
  const msg = messages[0];
  if (!msg.message || msg.key.fromMe) return;

  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith('@g.us');
  const sender = msg.key.participant || msg.key.remoteJid;
  const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
  const prefix = '!';

  // Verificar antilink y antispam
  if (isGroup) {
    const settings = groupSettings.get(chatId) || {};
    if (settings.antilink) {
      await checkAntilink(sock, msg, chatId, settings.antilink);
    }
    if (settings.antispam) {
      await checkAntispam(sock, msg, chatId);
    }
    if (settings.muted && settings.muted[sender]) {
      await sock.deleteMessage(chatId, msg.key);
      return;
    }
  }

  if (!text.startsWith(prefix)) return;

  const [cmd, ...args] = text.slice(prefix.length).trim().split(' ');
  const command = cmd.toLowerCase();

  // Restringir comandos si está activado el modo restrict
  const settings = groupSettings.get(chatId) || {};
  if (settings.restrict && !isOwner(sender, ownerNumber) && !isAdmin(sock, chatId, sender)) {
    await sock.sendMessage(chatId, { text: 'Solo admins pueden usar comandos en este modo.' });
    return;
  }

  // Ejecutar comando
  for (const category of Object.keys(commands)) {
    if (commands[category][command]) {
      try {
        await commands[category][command].execute(sock, msg, args, groupSettings, ownerNumber);
      } catch (err) {
        console.error(`Error ejecutando comando ${command}:`, err);
        await sock.sendMessage(chatId, { text: 'Error al ejecutar el comando.' });
      }
      break;
    }
  }
}

async function handleGroupEvent(sock, event, botNumber, groupSettings) {
  const { id, participants, action } = event;
  const settings = groupSettings.get(id) || {};
  
  if (action === 'add' && settings.welcome) {
    await handleWelcome(sock, id, participants[0], settings.welcome);
  } else if (action === 'remove' && settings.goodbye) {
    await sock.sendMessage(id, { text: `Adiós, @${participants[0].split('@')[0]}!` });
  }
}

async function checkAntilink(sock, msg, chatId, mode) {
  const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
  const isAdmin = await isAdmin(sock, chatId, msg.key.participant);
  if (text.includes('https://') || text.includes('http://')) {
    if (mode === 1 && text.includes('chat.whatsapp.com') && !isAdmin) {
      await sock.groupParticipantsUpdate(chatId, [msg.key.participant], 'remove');
      await sock.sendMessage(chatId, { text: `Expulsado por enviar link de grupo.` });
    } else if (mode === 2 && !isAdmin) {
      await sock.groupParticipantsUpdate(chatId, [msg.key.participant], 'remove');
      await sock.sendMessage(chatId, { text: `Expulsado por enviar cualquier link.` });
    } else if (mode === 3) {
      await sock.deleteMessage(chatId, msg.key);
      await sock.sendMessage(chatId, { text: `@${msg.key.participant.split('@')[0]}, modo antilink 3 activo. No envíes links.`, mentions: [msg.key.participant] });
    }
  }
}

async function checkAntispam(sock, msg, chatId) {
  // Implementar lógica de antispam (por ejemplo, detectar mensajes repetidos)
  // Guardar historial de mensajes por usuario y detectar spam
}

async function handleWelcome(sock, chatId, participant, mode) {
  const user = participant.split('@')[0];
  if (mode === 1) {
    await sock.sendMessage(chatId, { text: `Bienvenido, @${user}!`, mentions: [participant] });
  } else if (mode === 2 || mode === 3) {
    // Obtener foto de perfil
    try {
      const ppUrl = await sock.profilePictureUrl(participant, 'image');
      const img = await createSticker(ppUrl, { pack: 'Bienvenida', author: 'SubBot' });
      await sock.sendMessage(chatId, { sticker: img });
      if (mode === 2) {
        await sock.sendMessage(chatId, { text: `Bienvenido, @${user}!`, mentions: [participant] });
      }
    } catch (err) {
      await sock.sendMessage(chatId, { text: `Bienvenido, @${user}! (No se pudo cargar la foto)`, mentions: [participant] });
    }
  }
}

async function isAdmin(sock, chatId, participant) {
  const group = await sock.groupMetadata(chatId);
  return group.participants.some(p => p.id === participant && p.admin);
}

function isOwner(sender, ownerNumber) {
  return sender === ownerNumber;
}

module.exports = {
  loadCommands,
  handleMessage,
  handleGroupEvent,
  isAdmin,
  isOwner
};