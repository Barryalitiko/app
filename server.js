const express = require('express');
const path = require('path');

const app = express();
const PORT = 4000;

// Servir archivos estáticos desde /public
app.use(express.static(path.join(__dirname, 'public')));

// Redirigir raíz al index
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Hacer que el servidor escuche en todas las interfaces de red (0.0.0.0)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor WhatsApp Mock corriendo en http://0.0.0.0:${PORT}`);
});
