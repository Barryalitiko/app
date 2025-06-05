const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const P = require('pino');
const { loadCommands, handleMessage, handleGroupEvent } = require('./utils/loadCommon');

// Estado global para almacenar instancias de bots
const bots = new Map();
const groupSettings = new Map();
const ownerNumber = "1234567890@s.whatsapp.net"; // Número verificado del owner principal

// Cargar configuración de bots
async function loadBots() {
  const botData = JSON.parse(await fs.readFile('./database/bots.json', 'utf8'));
  for (const bot of botData.bots) {
    await startBot(bot.number);
  }
}

// Iniciar un bot
async function startBot(number) {
  const { state, saveCreds } = await useMultiFileAuthState(`./auth/${number}`);
  const logger = P({ level: 'silent' }, fs.createWriteStream(`./logs/${number}.log`, { flags: 'a' }));

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: true
  });

  bots.set(number, { sock, status: 'connecting' });

  // Manejo de conexión
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.error(`Bot ${number} desconectado:`, lastDisconnect?.error);
      if (shouldReconnect) {
        setTimeout(() => startBot(number), 5000); // Reintentar conexión
      } else {
        bots.delete(number);
        logger.info(`Bot ${number} logged out`);
      }
    } else if (connection === 'open') {
      bots.set(number, { sock, status: 'connected' });
      logger.info(`Bot ${number} conectado`);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Manejo de mensajes
  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      await handleMessage(sock, messages, number, groupSettings, ownerNumber);
    } catch (err) {
      logger.error(`Error en bot ${number} al procesar mensaje:`, err);
    }
  });

  // Manejo de eventos de grupo
  sock.ev.on('group-participants.update', async (event) => {
    try {
      await handleGroupEvent(sock, event, number, groupSettings);
    } catch (err) {
      logger.error(`Error en bot ${number} al procesar evento de grupo:`, err);
    }
  });
}

// Cargar comandos al iniciar
loadCommands();

// Iniciar todos los bots
loadBots().catch(err => console.error('Error al cargar bots:', err));

// Servidor web para control
const app = express();
app.use(express.json());
app.use(express.static('web'));

app.get('/bots', (req, res) => {
  const botList = Array.from(bots.entries()).map(([number, { status }]) => ({ number, status }));
  res.json(botList);
});

app.post('/announcement', async (req, res) => {
  const { message } = req.body;
  for (const [number, { sock }] of bots) {
    try {
      await sock.sendMessage(number, { text: message });
    } catch (err) {
      console.error(`Error enviando aviso a ${number}:`, err);
    }
  }
  res.json({ success: true });
});

app.post('/stop-bot', async (req, res) => {
  const { number } = req.body;
  const bot = bots.get(number);
  if (bot) {
    await bot.sock.end();
    bots.delete(number);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Bot no encontrado' });
  }
});

app.listen(3000, () => console.log('Servidor web en http://localhost:3000'));