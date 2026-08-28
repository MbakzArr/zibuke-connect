// Minimal Socket.io test client. Usage:
//   node socket-test-client.js <ACCESS_TOKEN> <CHANNEL_ID>
// Open two terminals with two different users' tokens on the SAME channel,
// type in one and watch it appear in the other instantly.

const { io } = require('socket.io-client');

const token = process.argv[2];
const channelId = process.argv[3];

if (!token || !channelId) {
  console.error('Usage: node socket-test-client.js <ACCESS_TOKEN> <CHANNEL_ID>');
  process.exit(1);
}

const socket = io('http://localhost:4000', { auth: { token } });

socket.on('connect', () => {
  console.log('Connected. Joining channel...');
  socket.emit('channel:join', channelId, (res) => {
    if (res && res.error) {
      console.error('Join failed:', res.error);
      process.exit(1);
    }
    console.log('Joined channel. Type a message and press Enter to send.\n');
  });
});

socket.on('message:new', (msg) => {
  console.log(`[${msg.sender_name || 'someone'}] ${msg.content}`);
});

socket.on('presence:update', (p) => {
  console.log(`(presence) ${p.userId} is now ${p.status}`);
});

socket.on('typing:update', (t) => {
  if (t.typing) console.log(`(${t.userId} is typing...)`);
});

socket.on('connect_error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

// Read lines from stdin and send them as messages.
process.stdin.on('data', (data) => {
  const content = data.toString().trim();
  if (content.length === 0) return;
  socket.emit('message:send', { channelId, content }, (res) => {
    // Print whatever the server sends back, so send failures are visible
    // instead of silent.
    if (res && res.error) {
      console.error('Send failed:', res.error);
    } else if (res && res.sent) {
      // message:new will also arrive and print it; this just confirms the ack
      console.log('(sent ok)');
    } else {
      console.error('No ack from server:', res);
    }
  });
});
