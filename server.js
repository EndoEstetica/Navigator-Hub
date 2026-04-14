// Navigator Call v6-lite — Backend
// Node.js + Express — bez TypeScript, bez Supabase
// Działa na Render bez problemów

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// ─── Konfiguracja ────────────────────────────────────────────────────────────

const GHL_TOKEN = process.env.GHL_TOKEN || 'pit-f5a34e95-71a5-44d6-abb0-7a46181ec62b';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'A0NcokQ5ZPxUcHawpRJJ';
const ZADARMA_KEY = process.env.ZADARMA_KEY || '26e6f4b692b9f016a127';
const ZADARMA_SECRET = process.env.ZADARMA_SECRET || '47e419742248a4dacb8b';
const PORT = process.env.PORT || 3000;

// ─── In-memory storage ───────────────────────────────────────────────────────

const calls = new Map(); // callId → call data
const users = {
  asia: { id: 'asia', name: 'Asia', role: 'reception', ext: '103', pin: '1001' },
  kasia: { id: 'kasia', name: 'Kasia', role: 'reception', ext: '103', pin: '1002' },
  agnieszka: { id: 'agnieszka', name: 'Agnieszka', role: 'reception', ext: '103', pin: '1003' },
  aneta: { id: 'aneta', name: 'Aneta', role: 'reception', ext: '103', pin: '1004' },
  agata: { id: 'agata', name: 'Agata', role: 'reception', ext: '103', pin: '1005' },
  bartosz: { id: 'bartosz', name: 'Bartosz', role: 'manager', ext: '103', pin: '2001' },
  sandra: { id: 'sandra', name: 'Sandra', role: 'manager', ext: '103', pin: '2002' },
  aneta_m: { id: 'aneta_m', name: 'Aneta (M)', role: 'manager', ext: '103', pin: '2003' },
  sonia: { id: 'sonia', name: 'Sonia', role: 'manager', ext: '103', pin: '2004' },
};

// ─── WebSocket broadcast ─────────────────────────────────────────────────────

function broadcast(msg) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(JSON.stringify(msg));
    }
  });
}

// ─── API: Logowanie ─────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { userId, pin } = req.body;
  const user = users[userId];
  
  if (!user || user.pin !== pin) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
  
  res.json({
    success: true,
    token: 'dummy-token',
    user: { id: user.id, name: user.name, role: user.role, ext: user.ext },
  });
});

// ─── API: Połączenia ────────────────────────────────────────────────────────

app.get('/api/calls/today', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const todayCalls = Array.from(calls.values())
    .filter(c => c.created_at.startsWith(today))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  const stats = {
    total: todayCalls.length,
    answered: todayCalls.filter(c => c.status === 'answered').length,
    missed: todayCalls.filter(c => c.status === 'no-answer' || c.status === 'missed').length,
    booked: todayCalls.filter(c => c.call_effect === 'umowiony_w0').length,
    avgDuration: 0,
    avgReactionTime: 0,
  };
  
  res.json({ calls: todayCalls, stats });
});

// ─── API: Wynik rozmowy ────────────────────────────────────────────────────

app.post('/api/call/outcome', (req, res) => {
  const { callId, contactId, callEffect, temperature, userId, patientName, notes } = req.body;
  
  if (calls.has(callId)) {
    const call = calls.get(callId);
    call.call_effect = callEffect;
    call.temperature = temperature;
    call.user_id = userId;
    call.patient_name = patientName;
    call.notes = notes;
    call.ghl_logged = true;
  }
  
  // Broadcast do WebSocket
  broadcast({
    type: 'CALL_OUTCOME_SAVED',
    callId,
    callEffect,
    temperature,
  });
  
  res.json({ success: true });
});

// ─── API: Statystyki ────────────────────────────────────────────────────────

app.get('/api/stats/user/:userId', (req, res) => {
  const { userId } = req.params;
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  
  const userCalls = Array.from(calls.values())
    .filter(c => c.created_at.startsWith(date) && c.user_id === userId);
  
  res.json({
    userId,
    total: userCalls.length,
    answered: userCalls.filter(c => c.status === 'answered').length,
    missed: userCalls.filter(c => c.status === 'no-answer').length,
    booked: userCalls.filter(c => c.call_effect === 'umowiony_w0').length,
    avgDuration: 0,
    avgReactionTime: 0,
  });
});

// ─── API: Health check ──────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Webhook: Zadarma ───────────────────────────────────────────────────────

function verifyZadarmaSignature(params, signature) {
  const sortedKeys = Object.keys(params)
    .filter(k => k !== 'sign')
    .sort();
  
  const paramString = sortedKeys
    .map(k => `${k}=${params[k]}`)
    .join('&');
  
  const md5Hash = crypto
    .createHash('md5')
    .update(paramString)
    .digest('hex');
  
  const hmac = crypto
    .createHmac('sha1', ZADARMA_SECRET)
    .update(md5Hash)
    .digest('base64');
  
  return hmac === signature;
}

app.post('/webhook/zadarma', (req, res) => {
  const { event, call_id, pbx_call_id, caller_id, called_did, seconds, sign } = req.body;
  
  // Weryfikacja podpisu
  if (!verifyZadarmaSignature(req.body, sign)) {
    console.log('[Zadarma] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  const callId = call_id || pbx_call_id || `call_${Date.now()}`;
  
  if (event === 'NOTIFY_START') {
    calls.set(callId, {
      id: callId,
      pbx_call_id,
      caller_phone: caller_id,
      called_phone: called_did,
      direction: 'inbound',
      status: 'ringing',
      duration_seconds: 0,
      created_at: new Date().toISOString(),
      ghl_logged: false,
    });
    
    broadcast({
      type: 'CALL_RINGING',
      callId,
      callerPhone: caller_id,
      calledPhone: called_did,
      internalExt: '103',
      patientName: null,
    });
  } else if (event === 'NOTIFY_ANSWER') {
    if (calls.has(callId)) {
      calls.get(callId).status = 'answered';
      calls.get(callId).answered_at = new Date().toISOString();
      
      broadcast({
        type: 'CALL_ANSWERED',
        callId,
        answeredAt: new Date().toISOString(),
      });
    }
  } else if (event === 'NOTIFY_END') {
    if (calls.has(callId)) {
      const call = calls.get(callId);
      call.status = call.status === 'answered' ? 'answered' : 'no-answer';
      call.duration_seconds = parseInt(seconds) || 0;
      call.ended_at = new Date().toISOString();
      
      broadcast({
        type: 'CALL_ENDED',
        callId,
        status: call.status,
        duration: call.duration_seconds,
      });
    }
  }
  
  res.json({ status: 'ok' });
});

// ─── Frontend static files ──────────────────────────────────────────────────

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// ─── WebSocket: Initial sync ───────────────────────────────────────────────

wss.on('connection', (ws) => {
  console.log('[WS] New connection');
  
  const today = new Date().toISOString().slice(0, 10);
  const todayCalls = Array.from(calls.values())
    .filter(c => c.created_at.startsWith(today))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  const stats = {
    total: todayCalls.length,
    answered: todayCalls.filter(c => c.status === 'answered').length,
    missed: todayCalls.filter(c => c.status === 'no-answer').length,
    booked: todayCalls.filter(c => c.call_effect === 'umowiony_w0').length,
    avgDuration: 0,
    avgReactionTime: 0,
  };
  
  ws.send(JSON.stringify({
    type: 'INIT',
    calls: todayCalls,
    stats,
  }));
});

// ─── Start server ───────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`🚀 Navigator Call v6-lite running on port ${PORT}`);
  console.log(`📞 WebSocket: ws://localhost:${PORT}`);
  console.log(`🌐 HTTP: http://localhost:${PORT}`);
});
