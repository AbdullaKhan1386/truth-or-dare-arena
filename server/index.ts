import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { 
  connectDb, 
  getPlayerProfile, 
  updatePlayerProfile, 
  addFriend, 
  removeFriend,
  PlayerProfile,
  MatchHistoryEntry 
} from './db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serving frontend build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.resolve(__dirname, '../dist')));
  app.get('*', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.resolve(__dirname, '../dist/index.html'));
  });
}

// REST APIs for profiles
app.get('/api/profile/:id', async (req, res) => {
  try {
    const profile = await getPlayerProfile(req.params.id);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

app.post('/api/profile/:id/update', async (req, res) => {
  try {
    const profile = await updatePlayerProfile(req.params.id, req.body);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.post('/api/profile/:id/add-friend', async (req, res) => {
  try {
    const success = await addFriend(req.params.id, req.body.friendId);
    if (success) {
      const updatedProfile = await getPlayerProfile(req.params.id);
      res.json(updatedProfile);
    } else {
      res.status(404).json({ error: 'Player or Friend not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to add friend' });
  }
});

app.post('/api/profile/:id/remove-friend', async (req, res) => {
  try {
    const success = await removeFriend(req.params.id, req.body.friendId);
    if (success) {
      const updatedProfile = await getPlayerProfile(req.params.id);
      res.json(updatedProfile);
    } else {
      res.status(404).json({ error: 'Player or Friend not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e8 // 100MB to allow dare media proofs (photo/video)
});

// TYPES & INTERFACES FOR SERVER STATE
interface LobbyPlayer {
  socketId: string;
  profileId: string;
  username: string;
  avatar: string;
  level: number;
  confirmedReady: boolean;
  currentMove: 'rock' | 'paper' | 'scissors' | null;
  moveHash: string | null;
  moveSecret: string | null;
  hasRevealed: boolean;
  score: number;
}

interface ChatMessage {
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  reaction?: string;
}

interface GameRoom {
  id: string;
  isPrivate: boolean;
  players: LobbyPlayer[];
  hostId: string; // profileId of the host player
  countdownDuration: number; // 3, 5, 7 seconds
  chatHistory: ChatMessage[];
  phase: 'lobby' | 'countdown' | 'reveal' | 'truth-dare-select' | 'truth-dare-input' | 'truth-dare-reveal' | 'post-round';
  winnerId: string | 'draw' | null;
  loserId: string | null;
  selectedAction: 'truth' | 'dare' | null;
  actionPrompt: string | null;
  actionResponse: string | null;
  actionProofMedia?: string | null;
  actionProofType?: 'image' | 'video' | null;
  rematchRequests: string[]; // List of player profile IDs requesting rematch
}

// Global state variables
const activeRooms = new Map<string, GameRoom>();
const onlinePlayers = new Map<string, string>(); // profileId -> socketId
let globalOnlineCount = 0;

// Track active invitations: senderId_targetId -> expirationTimestamp
const activeInvitations = new Map<string, number>();

// Matchmaking Lobby: active players in matchmaking screen
const matchmakingLobbyPlayers = new Map<string, { socketId: string; profileId: string; username: string; avatar: string; level: number; rank: string }>();
// Matchmaking Lobby invites: senderProfileId -> targetProfileId
const matchmakingLobbyInvites = new Map<string, string>();

// Matchmaking Queue: active players waiting for automatic pairing
const matchmakingQueue: { socketId: string; profileId: string; username: string; avatar: string; level: number; rank: string }[] = [];

// Helper to check if player is already in a match
function isPlayerInActiveGame(profileId: string): boolean {
  for (const room of activeRooms.values()) {
    if (room.players.some(p => p.profileId === profileId)) {
      return true;
    }
  }
  return false;
}

// Helper to calculate Rock-Paper-Scissors results
function getRPSResult(move1: 'rock' | 'paper' | 'scissors' | null, move2: 'rock' | 'paper' | 'scissors' | null): 'p1' | 'p2' | 'draw' {
  if (move1 === null && move2 === null) return 'draw';
  if (move1 === null) return 'p2';
  if (move2 === null) return 'p1';
  if (move1 === move2) return 'draw';
  if (
    (move1 === 'rock' && move2 === 'scissors') ||
    (move1 === 'paper' && move2 === 'rock') ||
    (move1 === 'scissors' && move2 === 'paper')
  ) {
    return 'p1';
  }
  return 'p2';
}

io.on('connection', (socket: Socket) => {
  globalOnlineCount++;
  io.emit('online-count', globalOnlineCount);

  let currentProfileId: string | null = null;
  let currentRoomId: string | null = null;

  // Player logs in
  socket.on('player-login', async (profileId: string) => {
    currentProfileId = profileId;
    onlinePlayers.set(profileId, socket.id);
    console.log(`Player logged in: ${profileId} (${socket.id})`);
    
    // Broadcast active requests/counts
    io.emit('online-count', globalOnlineCount);
  });

  // Helper to broadcast list of waiting players in matchmaking lobby
  const broadcastMatchmakingLobbyList = () => {
    const list = Array.from(matchmakingLobbyPlayers.values());
    for (const player of matchmakingLobbyPlayers.values()) {
      // Send others waiting in the lobby to this player
      const others = list.filter(p => p.profileId !== player.profileId);
      io.to(player.socketId).emit('matchmaking-lobby-sync', others);
    }
  };

  // Player enters online matchmaking screen
  socket.on('join-matchmaking', async (profileId: string) => {
    try {
      const profile = await getPlayerProfile(profileId);
      
      // Prevent duplicates
      const existingIdx = matchmakingQueue.findIndex(p => p.profileId === profileId);
      if (existingIdx !== -1) {
        matchmakingQueue[existingIdx].socketId = socket.id;
      } else {
        matchmakingQueue.push({
          socketId: socket.id,
          profileId: profile.id,
          username: profile.username,
          avatar: profile.avatar,
          level: profile.level,
          rank: profile.rank || '🥉 Bronze'
        });
      }
      
      console.log(`Player entered matchmaking queue: ${profileId}`);

      // Check if we have two or more players in the queue to create a match
      if (matchmakingQueue.length >= 2) {
        const player1 = matchmakingQueue.shift()!;
        const player2 = matchmakingQueue.shift()!;

        const senderSocketId = player1.socketId;
        const targetSocketId = player2.socketId;

        const s1 = io.sockets.sockets.get(senderSocketId);
        const s2 = io.sockets.sockets.get(targetSocketId);

        if (!s1 || !s2) {
          // Re-queue active players
          if (s1) matchmakingQueue.unshift(player1);
          if (s2) matchmakingQueue.unshift(player2);
          return;
        }

        const p1Profile = await getPlayerProfile(player1.profileId);
        const p2Profile = await getPlayerProfile(player2.profileId);

        const roomId = `room-match-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const gameRoom: GameRoom = {
          id: roomId,
          isPrivate: false,
          players: [
            { socketId: senderSocketId, profileId: p1Profile.id, username: p1Profile.username, avatar: p1Profile.avatar, level: p1Profile.level, confirmedReady: false, currentMove: null, moveHash: null, moveSecret: null, hasRevealed: false, score: 0 },
            { socketId: targetSocketId, profileId: p2Profile.id, username: p2Profile.username, avatar: p2Profile.avatar, level: p2Profile.level, confirmedReady: false, currentMove: null, moveHash: null, moveSecret: null, hasRevealed: false, score: 0 }
          ],
          hostId: player1.profileId,
          countdownDuration: 5,
          chatHistory: [],
          phase: 'lobby',
          winnerId: null,
          loserId: null,
          selectedAction: null,
          actionPrompt: null,
          actionResponse: null,
          rematchRequests: []
        };

        activeRooms.set(roomId, gameRoom);

        s1.join(roomId);
        s2.join(roomId);

        io.to(roomId).emit('match-found', {
          roomId,
          players: gameRoom.players
        });

        console.log(`Queue Match Room ${roomId} active: ${p1Profile.username} vs ${p2Profile.username}`);
      }
    } catch (err) {
      console.error('Error entering matchmaking queue', err);
    }
  });

  // Player exits online matchmaking screen
  socket.on('cancel-matchmaking', (profileId: string) => {
    try {
      const index = matchmakingQueue.findIndex(p => p.profileId === profileId);
      if (index !== -1) {
        matchmakingQueue.splice(index, 1);
      }
      console.log(`Player left matchmaking queue: ${profileId}`);
    } catch (err) {
      console.error('Error leaving matchmaking queue', err);
    }
  });

  // Send invitation from matchmaking screen
  socket.on('send-matchmaking-lobby-invite', async ({ senderId, targetId }) => {
    try {
      const target = matchmakingLobbyPlayers.get(targetId);
      if (!target) {
        socket.emit('invite-error', 'Player left the matchmaking screen');
        return;
      }
      
      const senderProfile = await getPlayerProfile(senderId);
      matchmakingLobbyInvites.set(senderId, targetId);
      
      io.to(target.socketId).emit('matchmaking-invite-received', {
        sender: {
          id: senderProfile.id,
          username: senderProfile.username,
          avatar: senderProfile.avatar,
          level: senderProfile.level
        }
      });
      console.log(`Matchmaking lobby invite sent from ${senderId} to ${targetId}`);
    } catch (err) {
      console.error(err);
    }
  });

  // Decline/Reject matchmaking invite
  socket.on('reject-matchmaking-lobby-invite', ({ senderId, targetId }) => {
    if (matchmakingLobbyInvites.get(senderId) === targetId) {
      matchmakingLobbyInvites.delete(senderId);
    }
    const senderSocket = onlinePlayers.get(senderId);
    if (senderSocket) {
      io.to(senderSocket).emit('matchmaking-invite-rejected', { targetId });
    }
    console.log(`Matchmaking lobby invite rejected by ${targetId} for ${senderId}`);
  });

  // Accept matchmaking invite
  socket.on('accept-matchmaking-lobby-invite', async ({ senderId, targetId }) => {
    try {
      if (matchmakingLobbyInvites.get(senderId) !== targetId) {
        socket.emit('invite-error', 'Invitation expired or invalid');
        return;
      }
      
      // Clean up invite
      matchmakingLobbyInvites.delete(senderId);
      
      // Remove both from matchmaking lobby
      matchmakingLobbyPlayers.delete(senderId);
      matchmakingLobbyPlayers.delete(targetId);
      
      // Broadcast updated matchmaking list
      broadcastMatchmakingLobbyList();

      const senderSocketId = onlinePlayers.get(senderId);
      const targetSocketId = onlinePlayers.get(targetId);

      if (!senderSocketId || !targetSocketId) {
        socket.emit('invite-error', 'Opponent went offline');
        return;
      }

      const p1Profile = await getPlayerProfile(senderId);
      const p2Profile = await getPlayerProfile(targetId);

      const roomId = `room-match-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const gameRoom: GameRoom = {
        id: roomId,
        isPrivate: false,
        players: [
          { socketId: senderSocketId, profileId: p1Profile.id, username: p1Profile.username, avatar: p1Profile.avatar, level: p1Profile.level, confirmedReady: false, currentMove: null, moveHash: null, moveSecret: null, hasRevealed: false, score: 0 },
          { socketId: targetSocketId, profileId: p2Profile.id, username: p2Profile.username, avatar: p2Profile.avatar, level: p2Profile.level, confirmedReady: false, currentMove: null, moveHash: null, moveSecret: null, hasRevealed: false, score: 0 }
        ],
        hostId: senderId,
        countdownDuration: 5,
        chatHistory: [],
        phase: 'lobby',
        winnerId: null,
        loserId: null,
        selectedAction: null,
        actionPrompt: null,
        actionResponse: null,
        rematchRequests: []
      };

      activeRooms.set(roomId, gameRoom);

      const s1 = io.sockets.sockets.get(senderSocketId);
      const s2 = io.sockets.sockets.get(targetSocketId);
      s1?.join(roomId);
      s2?.join(roomId);

      io.to(roomId).emit('match-found', {
        roomId,
        players: gameRoom.players
      });

      console.log(`Lobby Match Room ${roomId} active: ${p1Profile.username} vs ${p2Profile.username}`);
    } catch (err) {
      console.error(err);
    }
  });

  // Friend System: Invite
  socket.on('send-match-invite', async ({ senderId, targetId }) => {
    try {
      const targetSocketId = onlinePlayers.get(targetId);
      if (!targetSocketId) {
        socket.emit('invite-error', 'Player is currently offline');
        return;
      }

      // Check if target player is already in an active game
      if (isPlayerInActiveGame(targetId)) {
        socket.emit('invite-error', 'Player is already in a match');
        return;
      }

      const senderProfile = await getPlayerProfile(senderId);
      
      const inviteKey = `${senderId}_${targetId}`;
      const expiration = Date.now() + 30000; // 30 seconds
      activeInvitations.set(inviteKey, expiration);

      io.to(targetSocketId).emit('match-invite-received', {
        sender: {
          id: senderProfile.id,
          username: senderProfile.username,
          avatar: senderProfile.avatar,
          level: senderProfile.level
        }
      });
      console.log(`Match invite sent from ${senderId} to ${targetId}`);

      // Clean up after 30 seconds
      setTimeout(() => {
        if (activeInvitations.get(inviteKey) === expiration) {
          activeInvitations.delete(inviteKey);
          
          // Notify sender of timeout expiration
          const senderSocket = onlinePlayers.get(senderId);
          if (senderSocket) {
            io.to(senderSocket).emit('invite-expired', { targetId });
          }
          
          // Notify target of timeout expiration
          const targetSocket = onlinePlayers.get(targetId);
          if (targetSocket) {
            io.to(targetSocket).emit('invite-expired-target', { senderId });
          }
        }
      }, 30000);
    } catch (err) {
      console.error(err);
    }
  });

  // Friend System: Decline
  socket.on('decline-match-invite', ({ senderId, targetId }) => {
    const inviteKey = `${senderId}_${targetId}`;
    activeInvitations.delete(inviteKey);
    
    // Notify sender that target declined
    const senderSocket = onlinePlayers.get(senderId);
    if (senderSocket) {
      io.to(senderSocket).emit('invite-declined', { targetId });
    }
  });

  // Friend System: Accept
  socket.on('accept-match-invite', async ({ senderId, targetId }) => {
    const inviteKey = `${senderId}_${targetId}`;
    const expiration = activeInvitations.get(inviteKey);

    if (!expiration || Date.now() > expiration) {
      socket.emit('invite-error', 'Invitation has expired or is invalid');
      return;
    }

    // Remove active invitation once accepted
    activeInvitations.delete(inviteKey);

    const senderSocketId = onlinePlayers.get(senderId);
    const targetSocketId = onlinePlayers.get(targetId);

    if (!senderSocketId) {
      socket.emit('invite-error', 'Sender went offline');
      return;
    }

    try {
      const p1Profile = await getPlayerProfile(senderId);
      const p2Profile = await getPlayerProfile(targetId);

      const roomId = `room-private-${Date.now()}`;
      const gameRoom: GameRoom = {
        id: roomId,
        isPrivate: true,
        players: [
          { socketId: senderSocketId, profileId: p1Profile.id, username: p1Profile.username, avatar: p1Profile.avatar, level: p1Profile.level, confirmedReady: false, currentMove: null, moveHash: null, moveSecret: null, hasRevealed: false, score: 0 },
          { socketId: targetSocketId!, profileId: p2Profile.id, username: p2Profile.username, avatar: p2Profile.avatar, level: p2Profile.level, confirmedReady: false, currentMove: null, moveHash: null, moveSecret: null, hasRevealed: false, score: 0 }
        ],
        hostId: senderId,
        countdownDuration: 5,
        chatHistory: [],
        phase: 'lobby',
        winnerId: null,
        loserId: null,
        selectedAction: null,
        actionPrompt: null,
        actionResponse: null,
        rematchRequests: []
      };

      activeRooms.set(roomId, gameRoom);

      const s1 = io.sockets.sockets.get(senderSocketId);
      const s2 = io.sockets.sockets.get(targetSocketId!);

      s1?.join(roomId);
      s2?.join(roomId);

      io.to(roomId).emit('match-found', {
        roomId,
        players: gameRoom.players
      });

      console.log(`Private Match Room ${roomId} active: ${p1Profile.username} vs ${p2Profile.username}`);
    } catch (err) {
      console.error(err);
    }
  });

  // Client enters the match lobby room
  socket.on('join-game-room', (roomId: string) => {
    const room = activeRooms.get(roomId);
    if (room) {
      socket.join(roomId);
      currentRoomId = roomId;
      socket.emit('sync-game-state', room);
    }
  });

  // Lobby: Send Chat message
  socket.on('send-chat-msg', ({ roomId, text }) => {
    const room = activeRooms.get(roomId);
    if (room && currentProfileId) {
      const sender = room.players.find(p => p.profileId === currentProfileId);
      if (sender) {
        const msg: ChatMessage = {
          senderId: sender.profileId,
          senderName: sender.username,
          text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        room.chatHistory.push(msg);
        io.to(roomId).emit('chat-msg-received', msg);
      }
    }
  });

  // Lobby: Choose Countdown Duration
  socket.on('change-countdown', ({ roomId, profileId, duration }) => {
    const room = activeRooms.get(roomId);
    if (room) {
      if (profileId !== room.hostId) {
        console.warn(`Unauthorized countdown change attempt by ${profileId}`);
        return;
      }
      room.countdownDuration = duration;
      io.to(roomId).emit('countdown-changed', duration);
    }
  });

  // Lobby: Ready Confirmation
  socket.on('ready-confirm', ({ roomId, profileId }) => {
    const room = activeRooms.get(roomId);
    if (room) {
      const player = room.players.find(p => p.profileId === profileId);
      if (player) {
        player.confirmedReady = true;
      }

      // Check if both are ready
      const allReady = room.players.every(p => p.confirmedReady);
      if (allReady) {
        room.phase = 'countdown';
        room.winnerId = null;
        room.loserId = null;
        room.selectedAction = null;
        room.actionPrompt = null;
        room.actionResponse = null;
        
        io.to(roomId).emit('start-countdown', {
          duration: room.countdownDuration
        });
      } else {
        io.to(roomId).emit('sync-game-state', room);
      }
    }
  });

  // Countdown Phase 1: Commit hash of move + secret
  socket.on('commit-move', ({ roomId, profileId, hash }) => {
    const room = activeRooms.get(roomId);
    if (room) {
      const player = room.players.find(p => p.profileId === profileId);
      if (player) {
        player.moveHash = hash;
        player.moveSecret = null;
        player.currentMove = null;
        player.hasRevealed = false;
      }

      // Check if both players have committed
      const bothCommitted = room.players.every(p => p.moveHash !== null);
      if (bothCommitted) {
        io.to(roomId).emit('both-committed');
      }
    }
  });

  // Countdown Phase 2: Reveal actual move + secret
  socket.on('reveal-move', ({ roomId, profileId, move, secret }) => {
    const room = activeRooms.get(roomId);
    if (room) {
      const player = room.players.find(p => p.profileId === profileId);
      if (player) {
        const calculatedHash = createHash('sha256').update(move + secret).digest('hex');
        if (calculatedHash !== player.moveHash) {
          console.error(`Cheat detected! Hash mismatch for player ${profileId}`);
          player.currentMove = null;
        } else {
          player.currentMove = move;
        }
        player.moveSecret = secret;
        player.hasRevealed = true;
      }

      // Check if both players have attempted to reveal
      const bothRevealed = room.players.every(p => p.hasRevealed);
      if (bothRevealed) {
        const p1 = room.players[0];
        const p2 = room.players[1];

        const result = getRPSResult(p1.currentMove, p2.currentMove);
        
        room.phase = 'reveal';

        if (result === 'draw') {
          room.winnerId = 'draw';
          room.loserId = null;
        } else if (result === 'p1') {
          room.winnerId = p1.profileId;
          room.loserId = p2.profileId;
          p1.score++;
        } else {
          room.winnerId = p2.profileId;
          room.loserId = p1.profileId;
          p2.score++;
        }

        io.to(roomId).emit('reveal-moves', {
          p1Id: p1.profileId,
          p1Move: p1.currentMove,
          p2Id: p2.profileId,
          p2Move: p2.currentMove,
          winnerId: room.winnerId,
          loserId: room.loserId
        });

        // Reset hashes and reveal flags
        room.players.forEach(p => {
          p.moveHash = null;
          p.moveSecret = null;
          p.hasRevealed = false;
        });

        // Trigger statistics updates
        if (result !== 'draw') {
          updateStatsAfterRound(room.winnerId!, room.loserId!, roomId);
        }
      }
    }
  });

  // Helper function to update databases and streaks
  async function updateStatsAfterRound(winnerId: string, loserId: string, roomId: string) {
    try {
      const winner = await getPlayerProfile(winnerId);
      const loser = await getPlayerProfile(loserId);

      const dateStr = new Date().toLocaleDateString();

      // Update Winner
      const wMatch: MatchHistoryEntry = {
        matchId: roomId,
        opponentId: loserId,
        opponentName: loser.username,
        date: dateStr,
        result: 'win',
        rounds: 1
      };
      const updatedWinner = await updatePlayerProfile(winnerId, {
        wins: winner.wins + 1,
        gamesPlayed: winner.gamesPlayed + 1,
        xp: winner.xp + 25, // +25 XP for win
        activeStreak: winner.activeStreak + 1,
        matchHistory: [wMatch, ...winner.matchHistory.slice(0, 9)]
      });
      const winnerSocketId = onlinePlayers.get(winnerId);
      if (winnerSocketId) {
        io.to(winnerSocketId).emit('profile-updated', updatedWinner);
      }

      // Update Loser
      const lMatch: MatchHistoryEntry = {
        matchId: roomId,
        opponentId: winnerId,
        opponentName: winner.username,
        date: dateStr,
        result: 'loss',
        rounds: 1
      };
      const updatedLoser = await updatePlayerProfile(loserId, {
        losses: loser.losses + 1,
        gamesPlayed: loser.gamesPlayed + 1,
        xp: loser.xp + 10, // +10 XP for effort
        activeStreak: 0,
        matchHistory: [lMatch, ...loser.matchHistory.slice(0, 9)]
      });
      const loserSocketId = onlinePlayers.get(loserId);
      if (loserSocketId) {
        io.to(loserSocketId).emit('profile-updated', updatedLoser);
      }
    } catch (err) {
      console.error('Failed to update player database stats', err);
    }
  }

  // Next Phase Transition (triggered after Phaser animations complete on client)
  socket.on('finish-animations', ({ roomId }) => {
    const room = activeRooms.get(roomId);
    if (room && room.phase === 'reveal') {
      if (room.winnerId === 'draw') {
        // Draw triggers instant rematch directly without going back to lobby
        room.phase = 'countdown';
        room.winnerId = null;
        room.loserId = null;
        room.selectedAction = null;
        room.actionPrompt = null;
        room.actionResponse = null;
        room.players.forEach(p => {
          p.confirmedReady = true;
          p.currentMove = null;
          p.moveHash = null;
          p.moveSecret = null;
          p.hasRevealed = false;
        });
        io.to(roomId).emit('sync-game-state', room);
        io.to(roomId).emit('start-countdown', {
          duration: room.countdownDuration
        });
      } else {
        // Winner declared, transition to loser choice phase
        room.phase = 'truth-dare-select';
        io.to(roomId).emit('sync-game-state', room);
      }
    }
  });

  // Loser Phase: Choose Truth or Dare
  socket.on('select-action', ({ roomId, action }) => {
    const room = activeRooms.get(roomId);
    if (room && room.phase === 'truth-dare-select') {
      room.selectedAction = action;
      room.phase = 'truth-dare-input';
      io.to(roomId).emit('action-selected', { action });
    }
  });

  // Winner Phase: Write & Submit Challenge
  socket.on('submit-prompt', ({ roomId, prompt }) => {
    const room = activeRooms.get(roomId);
    if (room && room.phase === 'truth-dare-input') {
      room.actionPrompt = prompt;
      io.to(roomId).emit('prompt-received', { prompt });
    }
  });

  // Loser Phase: Write & Submit Response
  socket.on('submit-response', async ({ roomId, response, proofMedia, proofType }) => {
    const room = activeRooms.get(roomId);
    if (room) {
      room.actionResponse = response;
      room.actionProofMedia = proofMedia || null;
      room.actionProofType = proofType || null;
      room.phase = 'truth-dare-reveal';
      
      io.to(roomId).emit('response-received', { 
        response, 
        proofMedia: room.actionProofMedia, 
        proofType: room.actionProofType 
      });

      // Reward XP for completing Truth/Dare
      if (room.loserId) {
        try {
          const loser = await getPlayerProfile(room.loserId);
          const updates: Partial<PlayerProfile> = {
            xp: loser.xp + 15 // +15 XP for completing dare/truth
          };
          if (room.selectedAction === 'truth') {
            updates.truthCompleted = loser.truthCompleted + 1;
          } else {
            updates.daresCompleted = loser.daresCompleted + 1;
          }
          const updatedLoser = await updatePlayerProfile(room.loserId, updates);
          const loserSocketId = onlinePlayers.get(room.loserId);
          if (loserSocketId) {
            io.to(loserSocketId).emit('profile-updated', updatedLoser);
          }
        } catch (err) {
          console.error(err);
        }
      }
    }
  });

  // Skip or Report Option
  socket.on('skip-action', ({ roomId }) => {
    const room = activeRooms.get(roomId);
    if (room) {
      room.phase = 'lobby';
      room.winnerId = null;
      room.loserId = null;
      room.selectedAction = null;
      room.actionPrompt = null;
      room.actionResponse = null;
      room.actionProofMedia = null;
      room.actionProofType = null;
      room.rematchRequests = [];
      room.players.forEach(p => {
        p.confirmedReady = false;
        p.currentMove = null;
      });
      io.to(roomId).emit('sync-game-state', room);
    }
  });

  // End Interaction: Go back to Lobby immediately for next round
  socket.on('goto-post-round', ({ roomId }) => {
    const room = activeRooms.get(roomId);
    if (room) {
      room.phase = 'lobby';
      room.winnerId = null;
      room.loserId = null;
      room.selectedAction = null;
      room.actionPrompt = null;
      room.actionResponse = null;
      room.actionProofMedia = null;
      room.actionProofType = null;
      room.rematchRequests = [];
      room.players.forEach(p => {
        p.confirmedReady = false;
        p.currentMove = null;
      });
      io.to(roomId).emit('sync-game-state', room);
    }
  });

  // Post-Round: Rematch request
  socket.on('request-rematch', ({ roomId, profileId }) => {
    const room = activeRooms.get(roomId);
    if (room && room.phase === 'post-round') {
      if (!room.rematchRequests.includes(profileId)) {
        room.rematchRequests.push(profileId);
      }

      // Check if both request rematch
      if (room.rematchRequests.length >= 2) {
        // Reset game state for next round
        room.phase = 'lobby';
        room.winnerId = null;
        room.loserId = null;
        room.selectedAction = null;
        room.actionPrompt = null;
        room.actionResponse = null;
        room.actionProofMedia = null;
        room.actionProofType = null;
        room.rematchRequests = [];
        room.players.forEach(p => {
          p.confirmedReady = false;
          p.currentMove = null;
        });

        io.to(roomId).emit('rematch-start', room);
      } else {
        io.to(roomId).emit('rematch-requested', { requesterId: profileId });
      }
    }
  });

  // Post-Round: Exit match
  socket.on('exit-match', ({ roomId }) => {
    socket.leave(roomId);
    const room = activeRooms.get(roomId);
    if (room) {
      activeRooms.delete(roomId);
      io.to(roomId).emit('opponent-left');
    }
  });

  // Clean disconnects
  socket.on('disconnect', () => {
    globalOnlineCount--;
    io.emit('online-count', globalOnlineCount);

    if (currentProfileId) {
      onlinePlayers.delete(currentProfileId);
      
      // Clean matchmaking queue
      const idx = matchmakingQueue.findIndex(p => p.profileId === currentProfileId);
      if (idx !== -1) {
        matchmakingQueue.splice(idx, 1);
      }

      // Clean matchmaking lobby
      matchmakingLobbyPlayers.delete(currentProfileId);
      matchmakingLobbyInvites.delete(currentProfileId);
      for (const [senderId, targetId] of matchmakingLobbyInvites.entries()) {
        if (targetId === currentProfileId) {
          matchmakingLobbyInvites.delete(senderId);
          const senderSocket = onlinePlayers.get(senderId);
          if (senderSocket) {
            io.to(senderSocket).emit('matchmaking-invite-rejected', { targetId: currentProfileId });
          }
        }
      }
      broadcastMatchmakingLobbyList();
    }

    if (currentRoomId) {
      const room = activeRooms.get(currentRoomId);
      if (room) {
        activeRooms.delete(currentRoomId);
        io.to(currentRoomId).emit('opponent-left');
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
connectDb().then(() => {
  server.listen(PORT, () => {
    console.log(`Truth or Dare Arena server listening on port ${PORT}`);
  });
});
