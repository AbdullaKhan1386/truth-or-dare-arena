import React, { useState, useEffect, useRef } from 'react';
import { 
  Trophy, 
  Settings, 
  Users, 
  MessageSquare, 
  Volume2, 
  VolumeX, 
  Send, 
  Play, 
  UserPlus, 
  AlertCircle,
  X
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import audio from './components/AudioEngine';
import GameArena from './components/GameArena';

// Types
import type { PlayerProfile } from './types';

const socketUrl = window.location.hostname === 'localhost' ? 'http://localhost:3001/' : '/';

interface ChatMessage {
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

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

interface IncomingInvite {
  id: string; // senderId
  username: string;
  avatar: string;
  level: number;
  receivedAt: number;
  timeLeft: number;
}

interface GameRoom {
  id: string;
  isPrivate: boolean;
  players: LobbyPlayer[];
  hostId: string;
  countdownDuration: number;
  chatHistory: ChatMessage[];
  phase: 'lobby' | 'countdown' | 'reveal' | 'truth-dare-select' | 'truth-dare-input' | 'truth-dare-reveal' | 'post-round';
  winnerId: string | 'draw' | null;
  loserId: string | null;
  selectedAction: 'truth' | 'dare' | null;
  actionPrompt: string | null;
  actionResponse: string | null;
  actionProofMedia?: string | null;
  actionProofType?: 'image' | 'video' | null;
  rematchRequests: string[];
}

const ChatMessagesList = React.memo(({ chatHistory, players, myProfileId }: { chatHistory: ChatMessage[], players: LobbyPlayer[], myProfileId: string }) => {
  return (
    <>
      {chatHistory.map((msg, idx) => {
        const player = players.find(p => p.profileId === msg.senderId);
        return (
          <div 
            key={idx} 
            className={`chat-bubble ${msg.senderId === myProfileId ? 'sent' : 'received'}`}
          >
            <div className="chat-sender-name">
              {msg.senderName}
            </div>
            <div className="chat-bubble-text-content">
              <span className="chat-mobile-avatar">
                {player?.avatar || '👤'}
              </span>
              <span className="chat-bubble-text">{msg.text}</span>
            </div>
            <div className="chat-timestamp">
              {msg.timestamp}
            </div>
          </div>
        );
      })}
    </>
  );
});

const AVATARS = [
  '🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🦁', '🐮', '🐷', '🐸', 
  '🐵', '🐔', '🐧', '🦆', '🦉', '🦖', '🦄', '🐝', '🐙', '🎨'
];

export default function App() {
  // Socket Client Ref
  const socketRef = useRef<Socket | null>(null);

  // Sound settings
  const [muted, setMuted] = useState(false);

  // Player state
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);

  // App routing/screens state
  // 'login' | 'home' | 'matchmaking' | 'game'
  const [screen, setScreen] = useState<'login' | 'home' | 'matchmaking' | 'game'>('login');

  // Modals state
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showInvitationsModal, setShowInvitationsModal] = useState(false);

  const [inviteFriendId, setInviteFriendId] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [activeInvites, setActiveInvites] = useState<IncomingInvite[]>([]);
  const [recentInvites, setRecentInvites] = useState<{ id: string; username: string; avatar: string; level: number; expiredAt: number }[]>([]);
  const [inviteStatus, setInviteStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Settings local states
  const [usernameInput, setUsernameInput] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('');

  // Game/Matchmaking states
  const [currentRoom, setCurrentRoom] = useState<GameRoom | null>(null);
  const [selectedMove, setSelectedMove] = useState<'rock' | 'paper' | 'scissors' | null>(null);
  const [committedMove, setCommittedMove] = useState<'rock' | 'paper' | 'scissors' | null>(null);
  const [committedSecret, setCommittedSecret] = useState<string | null>(null);
  const [isLockedIn, setIsLockedIn] = useState<boolean>(false);
  const [countdownNum, setCountdownNum] = useState<number | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [challengeTimer, setChallengeTimer] = useState<number | null>(null);
  const isMobileChatOpenRef = useRef(false);

  const [isMobileView, setIsMobileView] = useState(() => window.innerWidth < 1200);
  const isMobileViewRef = useRef(isMobileView);

  useEffect(() => {
    isMobileViewRef.current = isMobileView;
  }, [isMobileView]);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1200;
      setIsMobileView(mobile);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleMobileChat = (open: boolean) => {
    setIsMobileChatOpen(open);
    isMobileChatOpenRef.current = open;
    if (open) {
      setUnreadCount(0);
    }
  };



  const sha256 = async (message: string): Promise<string> => {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Prompt / Response local inputs
  const [truthDarePrompt, setTruthDarePrompt] = useState('');
  const [truthDareResponse, setTruthDareResponse] = useState('');

  // Proof attachment states
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [proofType, setProofType] = useState<'image' | 'video' | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoTimer, setVideoTimer] = useState(0);
  const [showProofPreview, setShowProofPreview] = useState(false);

  // Refs for media recording
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const videoTimerIntervalRef = useRef<any>(null);

  // Chat scroll anchor ref
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<PlayerProfile | null>(null);
  const screenRef = useRef<'login' | 'home' | 'matchmaking' | 'game'>('login');
  const currentRoomRef = useRef<GameRoom | null>(null);
  const committedMoveRef = useRef<'rock' | 'paper' | 'scissors' | null>(null);
  const committedSecretRef = useRef<string | null>(null);


  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  useEffect(() => {
    committedMoveRef.current = committedMove;
  }, [committedMove]);

  useEffect(() => {
    committedSecretRef.current = committedSecret;
  }, [committedSecret]);



  // const [matchmakingLobbyPlayers, setMatchmakingLobbyPlayers] = useState<{ socketId: string; profileId: string; username: string; avatar: string; level: number; rank: string }[]>([]);
  // const [matchmakingInvite, setMatchmakingInvite] = useState<{ sender: { id: string; username: string; avatar: string; level: number } } | null>(null);
  // const [invitedPlayerId, setInvitedPlayerId] = useState<string | null>(null);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  // Active invites ticking timer
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveInvites(prev => {
        const next: IncomingInvite[] = [];
        prev.forEach(invite => {
          if (invite.timeLeft <= 1) {
            // Expired! Move to recent invites
            setRecentInvites(r => {
              const filtered = r.filter(x => x.id !== invite.id);
              return [{ id: invite.id, username: invite.username, avatar: invite.avatar, level: invite.level, expiredAt: Date.now() }, ...filtered];
            });
          } else {
            next.push({ ...invite, timeLeft: invite.timeLeft - 1 });
          }
        });
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Initialize socket & check local profile
  useEffect(() => {
    // Generate/Load Guest ID
    let guestId = localStorage.getItem('td_arena_player_id');
    if (!guestId) {
      const randNum = Math.floor(1000 + Math.random() * 9000);
      guestId = `TRUTH-${randNum}`;
      localStorage.setItem('td_arena_player_id', guestId);
    }

    // Connect socket
    const socket = io(window.location.hostname === 'localhost' ? 'http://localhost:3001' : '/', {
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('player-login', guestId);
      if (screenRef.current === 'matchmaking') {
        socket.emit('join-matchmaking', guestId);
      }
    });

    // Load initial profile from API
    fetch(`${socketUrl}api/profile/${guestId}`)
      .then(res => res.json())
      .then(data => {
        setProfile(data);
        setUsernameInput(data.username);
        setSelectedAvatar(data.avatar);
        // Login to socket
        socket.emit('player-login', data.id);
        setScreen('home');
      })
      .catch(err => {
        console.error('Failed to load profile', err);
        // Fallback to local profile generation if server offline
        const fallbackProfile: PlayerProfile = {
          id: guestId!,
          username: `Guest-${guestId!.split('-')[1]}`,
          avatar: '🐼',
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          truthCompleted: 0,
          daresCompleted: 0,
          winPercentage: 0,
          xp: 0,
          level: 1,
          currentTitle: 'Rookie',
          activeStreak: 0,
          friends: [],
          matchHistory: [],
          achievements: [],
          rank: '🥉 Bronze'
        };
        setProfile(fallbackProfile);
        setUsernameInput(fallbackProfile.username);
        setSelectedAvatar(fallbackProfile.avatar);
        // Register to socket even on fallback
        socket.emit('player-login', fallbackProfile.id);
        setScreen('home');
      });

    // Listeners
    socket.on('online-count', (count: number) => {
      setOnlineCount(count);
    });

    // socket.on('matchmaking-lobby-sync', (players: any[]) => {
    //   setMatchmakingLobbyPlayers(players);
    // });

    // socket.on('matchmaking-invite-received', (data: any) => {
    //   if (!muted) audio.playTick();
    //   setMatchmakingInvite(data);
    // });

    // socket.on('matchmaking-invite-rejected', (data: { targetId: string }) => {
    //   setInvitedPlayerId(prev => prev === data.targetId ? null : prev);
    //   setInviteStatus({ type: 'error', message: 'Invitation was rejected' });
    //   setTimeout(() => setInviteStatus(null), 3000);
    // });

    socket.on('invite-error', (msg: string) => {
      setInviteError(msg);
      setInviteStatus({ type: 'error', message: msg });
      setTimeout(() => setInviteError(''), 4000);
    });

    socket.on('invite-expired', (data: { targetId: string }) => {
      setInviteStatus({ type: 'error', message: `Invitation to ${data.targetId} has expired.` });
    });

    socket.on('invite-expired-target', (data: { senderId: string }) => {
      // Move from active to recent when expired on server
      setActiveInvites(prev => {
        const invite = prev.find(i => i.id === data.senderId);
        if (invite) {
          setRecentInvites(r => {
            const filtered = r.filter(x => x.id !== invite.id);
            return [{ id: invite.id, username: invite.username, avatar: invite.avatar, level: invite.level, expiredAt: Date.now() }, ...filtered];
          });
        }
        return prev.filter(i => i.id !== data.senderId);
      });
    });

    socket.on('match-invite-received', (data: { sender: { id: string; username: string; avatar: string; level: number } }) => {
      if (!muted) audio.playTick();
      setActiveInvites(prev => {
        const filtered = prev.filter(inv => inv.id !== data.sender.id);
        return [...filtered, { ...data.sender, receivedAt: Date.now(), timeLeft: 30 }];
      });
    });

    socket.on('match-found', (data: { roomId: string; players: LobbyPlayer[] }) => {
      if (!muted) audio.playCheer();
      // Reset local game inputs
      setSelectedMove(null);
      setIsLockedIn(false);
      setCommittedMove(null);
      setCommittedSecret(null);
      setCountdownNum(null);
      setTruthDarePrompt('');
      setTruthDareResponse('');
      // setInvitedPlayerId(null);
      // setMatchmakingInvite(null);
      setScreen('game');
      // Request state sync
      socket.emit('join-game-room', data.roomId);
    });

    socket.on('sync-game-state', (room: GameRoom) => {
      setCurrentRoom(room);
      // Auto scroll chat
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        const containers = document.querySelectorAll('.chat-messages');
        containers.forEach(el => {
          el.scrollTop = el.scrollHeight;
        });
      }, 100);
    });

    socket.on('chat-msg-received', (msg: ChatMessage) => {
      setCurrentRoom(prev => {
        if (!prev) return null;
        return { ...prev, chatHistory: [...prev.chatHistory, msg] };
      });

      if (profileRef.current && msg.senderId !== profileRef.current.id && !isMobileChatOpenRef.current) {
        setUnreadCount(prev => prev + 1);
      }

      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        const containers = document.querySelectorAll('.chat-messages');
        containers.forEach(el => {
          el.scrollTop = el.scrollHeight;
        });
      }, 100);
    });

    socket.on('countdown-changed', (duration: number) => {
      setCurrentRoom(prev => {
        if (!prev) return null;
        return { ...prev, countdownDuration: duration };
      });
    });

    socket.on('start-countdown', (data: { duration: number }) => {
      setSelectedMove(null);
      setIsLockedIn(false);
      setCommittedMove(null);
      setCommittedSecret(null);
      setCountdownNum(data.duration);
      setCurrentRoom(prev => {
        if (!prev) return null;
        return { ...prev, phase: 'countdown' };
      });
    });

    socket.on('reveal-moves', (data: any) => {
      setCurrentRoom(prev => {
        if (!prev) return null;
        // Update players moves locally in room state
        const updatedPlayers = prev.players.map(p => {
          if (p.profileId === data.p1Id) return { ...p, currentMove: data.p1Move };
          if (p.profileId === data.p2Id) return { ...p, currentMove: data.p2Move };
          return p;
        });

        return {
          ...prev,
          players: updatedPlayers,
          phase: 'reveal',
          winnerId: data.winnerId,
          loserId: data.loserId
        };
      });
      
      // Update local profile stats from database
      if (profileRef.current) {
        fetch(`${socketUrl}api/profile/${profileRef.current.id}`)
          .then(res => res.json())
          .then(data => setProfile(data))
          .catch(e => console.error(e));
      }
    });

    socket.on('both-committed', () => {
      if (socketRef.current && currentRoomRef.current && profileRef.current) {
        socketRef.current.emit('reveal-move', {
          roomId: currentRoomRef.current.id,
          profileId: profileRef.current.id,
          move: committedMoveRef.current,
          secret: committedSecretRef.current
        });
      }
      setIsLockedIn(false);
      setCommittedMove(null);
      setCommittedSecret(null);
    });

    socket.on('action-selected', (data: { action: 'truth' | 'dare' }) => {
      setCurrentRoom(prev => {
        if (!prev) return null;
        return { ...prev, selectedAction: data.action, phase: 'truth-dare-input' };
      });
    });

    socket.on('prompt-received', (data: { prompt: string }) => {
      setCurrentRoom(prev => {
        if (!prev) return null;
        return { ...prev, actionPrompt: data.prompt };
      });
    });

    socket.on('response-received', (data: { response: string, proofMedia?: string | null, proofType?: 'image' | 'video' | null }) => {
      setCurrentRoom(prev => {
        if (!prev) return null;
        return { 
          ...prev, 
          actionResponse: data.response, 
          actionProofMedia: data.proofMedia,
          actionProofType: data.proofType,
          phase: 'truth-dare-reveal' 
        };
      });
      
      // Refresh XP/Achievements
      if (profileRef.current) {
        fetch(`${socketUrl}api/profile/${profileRef.current.id}`)
          .then(res => res.json())
          .then(data => setProfile(data))
          .catch(e => console.error(e));
      }
    });

    socket.on('action-skipped', () => {
      setCurrentRoom(prev => {
        if (!prev) return null;
        return { ...prev, phase: 'post-round' };
      });
    });

    socket.on('rematch-requested', (data: { requesterId: string }) => {
      setCurrentRoom(prev => {
        if (!prev) return null;
        const reqs = [...prev.rematchRequests];
        if (!reqs.includes(data.requesterId)) {
          reqs.push(data.requesterId);
        }
        return { ...prev, rematchRequests: reqs };
      });
    });

    socket.on('rematch-start', (room: GameRoom) => {
      setSelectedMove(null);
      setCountdownNum(null);
      setTruthDarePrompt('');
      setTruthDareResponse('');
      setCurrentRoom(room);
    });

    socket.on('opponent-left', () => {
      alert('Opponent disconnected or exited the match.');
      setScreen('home');
      setCurrentRoom(null);
    });

    socket.on('profile-updated', (updatedProfile: any) => {
      setProfile(prev => {
        if (prev && prev.id === updatedProfile.id) {
          return updatedProfile;
        }
        return prev;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Tick the countdown
  useEffect(() => {
    if (countdownNum === null) return;
    if (countdownNum > 0) {
      if (!muted) audio.playTick();
      const timer = setTimeout(() => {
        setCountdownNum(prev => (prev !== null ? prev - 1 : null));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [countdownNum, muted]);

  // Initialize and clean up challenge timer for Truth/Dare input
  useEffect(() => {
    if (
      currentRoom &&
      currentRoom.phase === 'truth-dare-input' &&
      profile &&
      currentRoom.winnerId === profile.id &&
      !currentRoom.actionPrompt
    ) {
      if (challengeTimer === null) {
        setChallengeTimer(60);
      }
    } else {
      if (challengeTimer !== null) {
        setChallengeTimer(null);
      }
    }
  }, [currentRoom?.phase, currentRoom?.actionPrompt, currentRoom?.winnerId, profile?.id, challengeTimer]);

  // Tick the challenge timer
  useEffect(() => {
    if (challengeTimer === null) return;

    if (challengeTimer > 0) {
      const timer = setTimeout(() => {
        setChallengeTimer(prev => (prev !== null ? prev - 1 : null));
      }, 1000);
      return () => clearTimeout(timer);
    } else if (challengeTimer === 0) {
      if (socketRef.current && currentRoom && profile) {
        const expiredPrompt = "Time Expired";
        setCurrentRoom(prev => {
          if (!prev) return null;
          return {
            ...prev,
            actionPrompt: expiredPrompt
          };
        });
        socketRef.current.emit('submit-prompt', {
          roomId: currentRoom.id,
          prompt: expiredPrompt
        });
      }
    }
  }, [challengeTimer, currentRoom, profile]);

  // Click Sound Handler
  const handleButtonClick = () => {
    if (!muted) audio.playClick();
  };

  // Profile Save
  const saveSettings = async () => {
    if (!profile) return;
    handleButtonClick();
    
    try {
      const res = await fetch(`${socketUrl}api/profile/${profile.id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, avatar: selectedAvatar })
      });
      const data = await res.json();
      setProfile(data);
      setShowSettingsModal(false);
    } catch (err) {
      console.error(err);
      // Local fallback
      setProfile(prev => prev ? { ...prev, username: usernameInput, avatar: selectedAvatar } : null);
      setShowSettingsModal(false);
    }
  };



  // Play Online Matchmaking Queue
  const startMatchmaking = () => {
    if (!profile || !socketRef.current) return;
    handleButtonClick();
    setScreen('matchmaking');
    socketRef.current.emit('join-matchmaking', profile.id);
  };

  const cancelMatchmaking = () => {
    if (!profile || !socketRef.current) return;
    handleButtonClick();
    socketRef.current.emit('cancel-matchmaking', profile.id);
    // setInvitedPlayerId(null);
    // setMatchmakingInvite(null);
    setScreen('home');
  };

  // const acceptMatchmakingInvite = () => {
  //   if (matchmakingInvite && socketRef.current && profile) {
  //     handleButtonClick();
  //     socketRef.current.emit('accept-matchmaking-lobby-invite', {
  //       senderId: matchmakingInvite.sender.id,
  //       targetId: profile.id
  //     });
  //     setMatchmakingInvite(null);
  //   }
  // };

  // const rejectMatchmakingInvite = () => {
  //   if (matchmakingInvite && socketRef.current && profile) {
  //     handleButtonClick();
  //     socketRef.current.emit('reject-matchmaking-lobby-invite', {
  //       senderId: matchmakingInvite.sender.id,
  //       targetId: profile.id
  //     });
  //     setMatchmakingInvite(null);
  //   }
  // };

  // const inviteMatchmakingPlayer = (targetId: string) => {
  //   if (socketRef.current && profile) {
  //     handleButtonClick();
  //     setInvitedPlayerId(targetId);
  //     socketRef.current.emit('send-matchmaking-lobby-invite', {
  //       senderId: profile.id,
  //       targetId
  //     });
  //   }
  // };

  // Play With Friend Modal Trigger
  const sendFriendInvite = () => {
    if (!profile || !inviteFriendId.trim() || !socketRef.current) return;
    handleButtonClick();
    setInviteStatus(null);
    socketRef.current.emit('send-match-invite', {
      senderId: profile.id,
      targetId: inviteFriendId.trim()
    });
    setInviteStatus({ type: 'success', message: `Invitation sent to ${inviteFriendId.trim()}!` });
    setInviteFriendId('');
  };

  const acceptIncomingInvite = (senderId: string) => {
    if (!profile || !socketRef.current) return;
    handleButtonClick();
    socketRef.current.emit('accept-match-invite', {
      senderId,
      targetId: profile.id
    });
    setActiveInvites(prev => prev.filter(i => i.id !== senderId));
  };

  const declineIncomingInvite = (senderId: string) => {
    if (!profile || !socketRef.current) return;
    handleButtonClick();
    socketRef.current.emit('decline-match-invite', {
      senderId,
      targetId: profile.id
    });
    setActiveInvites(prev => prev.filter(i => i.id !== senderId));
  };

  const getRecentOpponents = () => {
    if (!profile || !profile.matchHistory) return [];
    const seen = new Set<string>();
    const list: { id: string; name: string }[] = [];
    for (const match of profile.matchHistory) {
      if (!seen.has(match.opponentId)) {
        seen.add(match.opponentId);
        list.push({ id: match.opponentId, name: match.opponentName });
      }
    }
    return list;
  };

  // Lobby chat message submit
  const submitChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !currentRoom || !socketRef.current) return;
    socketRef.current.emit('send-chat-msg', {
      roomId: currentRoom.id,
      text: chatInput.trim()
    });
    setChatInput('');
  };

  // Pre-game ready confirm
  const confirmLobbyReady = () => {
    if (!currentRoom || !profile || !socketRef.current) return;
    handleButtonClick();
    setCurrentRoom(prev => {
      if (!prev) return null;
      return {
        ...prev,
        players: prev.players.map(p => 
          p.profileId === profile.id ? { ...p, confirmedReady: true } : p
        )
      };
    });
    socketRef.current.emit('ready-confirm', {
      roomId: currentRoom.id,
      profileId: profile.id
    });
  };

  // Change Countdown duration
  const changeCountdownDuration = (duration: number) => {
    if (!currentRoom || !socketRef.current || !profile) return;
    handleButtonClick();
    socketRef.current.emit('change-countdown', {
      roomId: currentRoom.id,
      profileId: profile.id,
      duration
    });
  };

  // Cryptographic move commitment
  const commitMove = (move: 'rock' | 'paper' | 'scissors') => {
    if (!currentRoom || !profile || !socketRef.current || isLockedIn) return;
    
    handleButtonClick();
    setSelectedMove(move);
    setIsLockedIn(true);
    
    const secret = Math.random().toString(36).substring(2, 10);
    setCommittedMove(move);
    setCommittedSecret(secret);
    
    sha256(move + secret).then(hash => {
      if (socketRef.current && currentRoomRef.current && profileRef.current) {
        socketRef.current.emit('commit-move', {
          roomId: currentRoomRef.current.id,
          profileId: profileRef.current.id,
          hash
        });
      }
    });
  };

  // Game selection: rock paper scissors
  const handleRPSSelection = (move: 'rock' | 'paper' | 'scissors') => {
    if (countdownNum === null) return; // Only allow during countdown phase
    commitMove(move);
  };

  // Phaser battleground animation completion
  const handlePhaserAnimationComplete = () => {
    if (!currentRoom || !socketRef.current) return;
    socketRef.current.emit('finish-animations', {
      roomId: currentRoom.id
    });
  };

  // Loser Truth/Dare choice card selection
  const selectTruthOrDare = (action: 'truth' | 'dare') => {
    if (!currentRoom || !socketRef.current) return;
    handleButtonClick();
    setCurrentRoom(prev => {
      if (!prev) return null;
      return {
        ...prev,
        selectedAction: action,
        phase: 'truth-dare-input'
      };
    });
    socketRef.current.emit('select-action', {
      roomId: currentRoom.id,
      action
    });
  };

  // Winner submit prompt
  const submitTruthDarePrompt = () => {
    if (!currentRoom || !truthDarePrompt.trim() || !socketRef.current) return;
    handleButtonClick();
    setCurrentRoom(prev => {
      if (!prev) return null;
      return {
        ...prev,
        actionPrompt: truthDarePrompt.trim()
      };
    });
    socketRef.current.emit('submit-prompt', {
      roomId: currentRoom.id,
      prompt: truthDarePrompt.trim()
    });
  };

  // Camera & Recording helpers
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 360, frameRate: 15 },
        audio: true
      });
      streamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
      }
      setIsCapturing(true);
      setProofPreviewUrl(null);
      setProofType(null);
    } catch (err) {
      console.error("Camera access failed:", err);
      alert("Could not access camera. Please check permissions.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
    setIsCapturing(false);
    setIsRecordingVideo(false);
    if (videoTimerIntervalRef.current) {
      clearInterval(videoTimerIntervalRef.current);
      videoTimerIntervalRef.current = null;
    }
  };

  const capturePhoto = () => {
    if (!cameraVideoRef.current) return;
    const video = cameraVideoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setProofPreviewUrl(dataUrl);
      setProofType('image');
    }
    stopCamera();
  };

  const startRecording = () => {
    if (!streamRef.current) return;
    recordedChunksRef.current = [];
    
    let options = {};
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
      options = { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 400000 };
    } else if (MediaRecorder.isTypeSupported('video/mp4')) {
      options = { mimeType: 'video/mp4', videoBitsPerSecond: 400000 };
    }
    
    const recorder = new MediaRecorder(streamRef.current, options);
    mediaRecorderRef.current = recorder;
    
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };
    
    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => {
        setProofPreviewUrl(reader.result as string);
        setProofType('video');
      };
    };
    
    recorder.start(250);
    setIsRecordingVideo(true);
    setVideoTimer(0);
    
    videoTimerIntervalRef.current = setInterval(() => {
      setVideoTimer(prev => {
        if (prev >= 9) {
          stopRecording();
          return 10;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecordingVideo(false);
    if (videoTimerIntervalRef.current) {
      clearInterval(videoTimerIntervalRef.current);
      videoTimerIntervalRef.current = null;
    }
    stopCamera();
  };

  const clearProofMedia = () => {
    setProofPreviewUrl(null);
    setProofType(null);
  };

  const compressImageAndSet = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Limit max dimensions to 800px to keep file size extremely small and fast
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        if (width > MAX_WIDTH || height > MAX_HEIGHT) {
          if (width > height) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          } else {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          // Compress to JPEG with 0.7 quality
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          setProofPreviewUrl(dataUrl);
          setProofType('image');
        } else {
          setProofPreviewUrl(event.target?.result as string);
          setProofType('image');
        }
      };
      img.onerror = () => {
        setProofPreviewUrl(event.target?.result as string);
        setProofType('image');
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video');
    const type = isVideo ? 'video' : 'image';

    if (type === 'video') {
      if (file.size > 5 * 1024 * 1024) {
        alert("Video file size must be under 5MB to ensure smooth transmission!");
        return;
      }
      const videoEl = document.createElement('video');
      videoEl.preload = 'metadata';
      videoEl.onloadedmetadata = () => {
        window.URL.revokeObjectURL(videoEl.src);
        if (videoEl.duration > 10.5) {
          alert("Video length must be 10 seconds or less!");
        } else {
          convertToBase64(file, 'video');
        }
      };
      videoEl.src = URL.createObjectURL(file);
    } else {
      if (file.size > 15 * 1024 * 1024) {
        alert("File is too large! Please choose an image under 15MB.");
        return;
      }
      compressImageAndSet(file);
    }
  };

  const convertToBase64 = (file: File, mediaType: 'image' | 'video') => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = () => {
      setProofPreviewUrl(reader.result as string);
      setProofType(mediaType);
    };
  };

  // Clean up streams on phase transitions
  useEffect(() => {
    if (currentRoom?.phase !== 'truth-dare-input') {
      stopCamera();
      setProofPreviewUrl(null);
      setProofType(null);
      setShowProofPreview(false);
    }
    if (currentRoom?.phase !== 'countdown') {
      setCountdownNum(null);
      setSelectedMove(null);
      setIsLockedIn(false);
      setCommittedMove(null);
      setCommittedSecret(null);
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [currentRoom?.phase]);

  // Loser submit response
  const submitTruthDareResponse = () => {
    if (!currentRoom || (!truthDareResponse.trim() && !proofPreviewUrl) || !socketRef.current) return;
    handleButtonClick();
    socketRef.current.emit('submit-response', {
      roomId: currentRoom.id,
      response: truthDareResponse.trim() || (proofType === 'video' ? '[Video Proof Attached]' : '[Image Proof Attached]'),
      proofMedia: proofPreviewUrl,
      proofType: proofType
    });
  };

  // Skip challenge/prompt
  const handleSkipAction = () => {
    if (!currentRoom || !socketRef.current) return;
    handleButtonClick();
    setCurrentRoom(prev => {
      if (!prev) return null;
      return {
        ...prev,
        phase: 'lobby',
        winnerId: null,
        loserId: null,
        selectedAction: null,
        actionPrompt: null,
        actionResponse: null,
        actionProofMedia: null,
        actionProofType: null,
        rematchRequests: []
      };
    });
    socketRef.current.emit('skip-action', {
      roomId: currentRoom.id
    });
  };

  // Next round transition
  const handleGotoPostRound = () => {
    if (!currentRoom || !socketRef.current) return;
    handleButtonClick();
    setCurrentRoom(prev => {
      if (!prev) return null;
      return {
        ...prev,
        phase: 'post-round'
      };
    });
    socketRef.current.emit('goto-post-round', {
      roomId: currentRoom.id
    });
  };

  // Rematch request
  const requestRematch = () => {
    if (!currentRoom || !profile || !socketRef.current) return;
    handleButtonClick();
    setCurrentRoom(prev => {
      if (!prev) return null;
      const reqs = [...prev.rematchRequests];
      if (!reqs.includes(profile.id)) {
        reqs.push(profile.id);
      }
      return { ...prev, rematchRequests: reqs };
    });
    socketRef.current.emit('request-rematch', {
      roomId: currentRoom.id,
      profileId: profile.id
    });
  };

  // Exit match room
  const exitGame = () => {
    if (!currentRoom || !socketRef.current) return;
    handleButtonClick();
    socketRef.current.emit('exit-match', {
      roomId: currentRoom.id
    });
    setScreen('home');
    setCurrentRoom(null);
  };

  // Friend Quick Add inside post-game
  const quickAddFriend = async (friendId: string) => {
    if (!profile) return;
    handleButtonClick();
    try {
      const res = await fetch(`${socketUrl}api/profile/${profile.id}/add-friend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendId })
      });
      const data = await res.json();
      setProfile(data);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className={screen === 'home' || screen === 'login' ? 'crayon-texture' : ''} style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      
      {/* Floating Doodles Background */}
      <div className="floating-doodle rock">✊</div>
      <div className="floating-doodle paper" style={{ top: '35%', right: '10%', animationDelay: '2s' }}>✋</div>
      <div className="floating-doodle scissors" style={{ bottom: '20%', left: '15%', animationDelay: '4s' }}>✌️</div>

      {/* Header bar */}
      <header className="game-header">
        <div className="header-left">
          {/* Desktop header title */}
          <div className="desktop-header-logo-title">
            <span className="header-logo">🎨</span>
            <span className="game-title">Truth or Dare Arena</span>
          </div>
          
          {/* Mobile header logo stack */}
          <div className="header-logo-container">
            <span className="header-logo-text">TRUTH OR DARE</span>
            <span className="header-logo-pill">ARENA</span>
          </div>
        </div>
        
        <div className="header-right">
          {profile && (
            <div className="header-level-box crayon-border-thin">
              <span className="header-level-avatar">{profile.avatar}</span>
              <span className="header-level-text">Lvl {profile.level}</span>
            </div>
          )}
          <button 
            className="crayon-btn header-mute-btn" 
            onClick={() => { setMuted(!muted); audio.playClick(); }}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </header>



      {/* SCREEN ROUTING */}
      {screen === 'home' && profile && (
        <main className="home-container">
          <div className="logo-container">
            <h1 className="game-logo">
              TRUTH OR DARE
              <span className="logo-sub">ARENA</span>
            </h1>
            <p style={{ marginTop: '0.8rem', color: '#4A4640', fontSize: '0.85rem', fontWeight: '700', letterSpacing: '0.05em' }}>
              Created by Slappy / Pathan.
            </p>
          </div>

          {isMobileView && (
            <div className="mobile-creator-credit" style={{ textAlign: 'left', color: '#4A4640', fontSize: '0.85rem', fontWeight: '700', margin: '0.2rem 0 0.5rem 0' }}>
              Created by Slappy / Pathan.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%' }}>
            {/* Active players count */}
            <div className="online-count-badge" style={{ textAlign: 'center', fontSize: '0.9rem', color: '#6A6660', fontWeight: '400' }}>
              🟢 {onlineCount} players active online
            </div>

            {/* Quick Stats Panel */}
            <div className="home-profile-card crayon-card">
              <div className="profile-card-left">
                <div className="profile-card-avatar">{profile.avatar}</div>
                <div className="profile-card-info">
                  <h2 className="profile-card-username">{profile.username}</h2>
                  <p className="profile-card-id">ID: {profile.id}</p>
                  <div className="profile-card-badges">
                    <span className="profile-badge badge-title">
                      🏆 {profile.currentTitle}
                    </span>
                    <span className="profile-badge badge-streak">
                      🔥 Streak: {profile.activeStreak}
                    </span>
                    <span className="profile-badge badge-rank">
                      Rank: {profile.rank || '🥉 Bronze'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="profile-card-right">
                <div className="profile-card-record">{profile.wins}W - {profile.losses}L</div>
                <div className="profile-card-winrate">Win Rate: {profile.winPercentage}%</div>
              </div>
            </div>
          </div>

          {/* Menu Options Grid */}
          <div className="menu-grid">
            <button className="crayon-btn crayon-btn-primary menu-grid-full" onClick={startMatchmaking}>
              <Play size={20} /> Play Online Matchmaking
            </button>
            <button 
              className={`crayon-btn menu-grid-full ${activeInvites.length > 0 ? 'crayon-btn-secondary' : 'crayon-btn-lavender'}`} 
              onClick={() => { handleButtonClick(); setShowInvitationsModal(true); }}
            >
              ✉️ Match Invites ({activeInvites.length})
            </button>
            <button className="crayon-btn crayon-btn-secondary" onClick={() => { handleButtonClick(); setInviteStatus(null); setInviteError(''); setShowInviteModal(true); }}>
              <UserPlus size={18} /> Play With Friend
            </button>
            <button className="crayon-btn crayon-btn-lavender" onClick={() => { handleButtonClick(); setShowFriendsModal(true); }}>
              <Users size={18} /> Recent Played
            </button>
            <button 
              className="crayon-btn crayon-btn-warning" 
              onClick={() => { 
                handleButtonClick(); 
                if (profile) {
                  fetch(`${socketUrl}api/profile/${profile.id}`)
                    .then(res => res.json())
                    .then(data => {
                      setProfile(data);
                      setShowProfileModal(true);
                    })
                    .catch(() => setShowProfileModal(true));
                } else {
                  setShowProfileModal(true);
                }
              }}
            >
              <Trophy size={18} /> Statistics & Badges
            </button>
            <button className="crayon-btn crayon-btn-success" onClick={() => { handleButtonClick(); setShowSettingsModal(true); }}>
              <Settings size={18} /> Edit Profile
            </button>
          </div>
        </main>
      )}

      {screen === 'matchmaking' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', width: '100%', maxWidth: '600px', margin: '0 auto', padding: '1rem' }}>
          <div className="pulse-bounce" style={{ fontSize: '4rem' }}>🎨</div>
          <h2 style={{ fontSize: '1.8rem', fontWeight: '800', color: '#4A4640' }}>Matchmaking Lobby</h2>
          
          {profile && (
            <div className="crayon-card" style={{ padding: '0.8rem 1.2rem', backgroundColor: '#ffffff', display: 'flex', alignItems: 'center', gap: '1rem', border: '3px solid #4A4640', borderRadius: '8px', boxShadow: '4px 4px 0px #4A4640' }}>
              <span style={{ fontSize: '2rem' }}>{profile.avatar}</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: '800', fontSize: '1.1rem', color: '#4A4640' }}>{profile.username} (You)</div>
                <div style={{ fontSize: '0.85rem', color: '#666' }}>ID: {profile.id}</div>
              </div>
            </div>
          )}

          <div className="crayon-card" style={{ width: '100%', padding: '1.5rem', backgroundColor: '#fff', border: '3px solid #4A4640', borderRadius: '12px', boxShadow: '6px 6px 0px #4A4640' }}>
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#777' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem', animation: 'spin 4s linear infinite' }}>⏳</div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#4A4640', marginBottom: '0.5rem' }}>Searching for opponent...</h3>
              <div style={{ fontSize: '0.85rem', color: '#999' }}>Please wait, pairing you with another player.</div>
            </div>
          </div>

          <button className="crayon-btn crayon-btn-error" onClick={cancelMatchmaking} style={{ marginTop: '0.5rem' }}>
            Exit Matchmaking
          </button>
        </div>
      )}

      {/* MATCHMAKING INCOMING INVITATION POPUP */}
      {/* {screen === 'matchmaking' && matchmakingInvite && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(3px)',
          padding: '1rem'
        }}>
          <div className="crayon-card popup-bounce" style={{
            width: '100%',
            maxWidth: '380px',
            backgroundColor: '#ffffff',
            padding: '1.5rem',
            textAlign: 'center',
            border: '4px solid #4A4640',
            boxShadow: '6px 6px 0px #4A4640'
          }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>🥊</div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#4A4640', marginBottom: '0.5rem' }}>Battle Invite!</h3>
            
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: '1rem', 
              margin: '1.2rem 0',
              padding: '0.8rem',
              backgroundColor: '#FDFBF7',
              border: '2px dashed #4A4640',
              borderRadius: '8px'
            }}>
              <span style={{ fontSize: '2.5rem' }}>{matchmakingInvite.sender.avatar}</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: '800', fontSize: '1.1rem', color: '#4A4640' }}>{matchmakingInvite.sender.username}</div>
                <div style={{ fontSize: '0.85rem', color: '#E4A853', fontWeight: '700' }}>LVL {matchmakingInvite.sender.level}</div>
              </div>
            </div>
            
            <p style={{ fontSize: '0.95rem', color: '#666', marginBottom: '1.5rem' }}>
              wants to challenge you to a duel! Do you accept?
            </p>
            
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
              <button 
                className="crayon-btn crayon-btn-success" 
                style={{ fontSize: '1rem', padding: '0.5rem 1rem', flex: 1 }}
                onClick={acceptMatchmakingInvite}
              >
                Accept ✅
              </button>
              <button 
                className="crayon-btn crayon-btn-error" 
                style={{ fontSize: '1rem', padding: '0.5rem 1rem', flex: 1 }}
                onClick={rejectMatchmakingInvite}
              >
                Reject ❌
              </button>
            </div>
          </div>
        </div>
      )} */}

      {screen === 'game' && currentRoom && profile && (
        <div className="game-grid">
          
          {/* LEFT COLUMN: CHAT & LOBBY PANEL */}
          {!isMobileView && (
            <div className={`chat-panel crayon-card ${currentRoom.phase !== 'lobby' ? 'hide-on-mobile-play' : ''} ${isMobileChatOpen ? 'mobile-expanded' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px dashed #ccc', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '1.1rem' }}>
                  <MessageSquare size={16} /> Lobby Chat
                </h3>
                <span style={{ fontSize: '0.8rem', color: '#777' }} className="desktop-only-room-info">Room: {currentRoom.isPrivate ? 'Private' : 'Online'}</span>
                <button type="button" className="mobile-chat-close-btn" onClick={() => toggleMobileChat(false)}>✕</button>
              </div>
              
              <div className="chat-messages">
                <ChatMessagesList chatHistory={currentRoom.chatHistory} players={currentRoom.players} myProfileId={profile.id} />
                <div ref={chatBottomRef} />
              </div>

              <form onSubmit={submitChatMessage} className="chat-input-area">
                <input 
                  type="text" 
                  className="crayon-input"
                  placeholder="Say hello... 👋" 
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                />
                <button type="submit" className="crayon-btn crayon-btn-primary" style={{ padding: '0.6rem 0.9rem' }}>
                  <Send size={16} />
                </button>
              </form>
            </div>
          )}

          {/* RIGHT COLUMN: MAIN BATTLEGROUND */}
          <div className={`crayon-card main-battleground-card ${currentRoom.phase === 'lobby' ? 'lobby-phase' : ''}`} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            
            {/* Global Players Row for Mobile Viewport */}
            {currentRoom.players && (
              <div className="mobile-players-row">
                <div className="mobile-player-item">
                  <span className="mobile-player-avatar">{currentRoom.players[0].avatar}</span>
                  <span className="mobile-player-info">Lv{currentRoom.players[0].level}</span>
                  {currentRoom.phase === 'lobby' && currentRoom.players[0].confirmedReady && (
                    <span className="mobile-player-ready">✓ Ready</span>
                  )}
                </div>
                <span className="mobile-vs-divider">VS</span>
                <div className="mobile-player-item">
                  <span className="mobile-player-avatar">{currentRoom.players[1]?.avatar || '👤'}</span>
                  <span className="mobile-player-info">
                    {currentRoom.players[1] ? `Lv${currentRoom.players[1].level}` : 'Waiting'}
                  </span>
                  {currentRoom.phase === 'lobby' && currentRoom.players[1]?.confirmedReady && (
                    <span className="mobile-player-ready">✓ Ready</span>
                  )}
                </div>
              </div>
            )}

            {/* LOBBY PHASE */}
            {currentRoom.phase === 'lobby' && (
              <div style={{ textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
                
                {/* 40% area for Title and VS card matchups */}
                <div className="mobile-game-area">
                  <div>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '0.2rem' }}>Pre-Game Lobby</h2>
                    <p style={{ color: '#666', fontSize: '0.85rem' }}>Decide details and confirm ready state.</p>
                  </div>

                  {/* Matchup Card UI */}
                  <div className="responsive-card-group" style={{ margin: '0.4rem 0' }}>
                    {currentRoom.players.map((p, idx) => (
                      <React.Fragment key={p.profileId}>
                        <div className="crayon-border-thin" style={{ padding: '0.5rem', width: '100px', backgroundColor: p.confirmedReady ? '#A7E8C5' : '#ffffff' }}>
                          <div style={{ fontSize: '2.2rem' }}>{p.avatar}</div>
                          <h4 style={{ fontWeight: '700', marginTop: '0.2rem', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.username}
                          </h4>
                          <div style={{ fontSize: '0.7rem', color: '#666' }}>Lvl {p.level}</div>
                          <div style={{ marginTop: '0.2rem' }}>
                            {p.confirmedReady ? (
                              <span style={{ fontSize: '0.75rem', color: 'green', fontWeight: '700' }}>✓ Ready</span>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: '#777' }}>Waiting...</span>
                            )}
                          </div>
                        </div>
                        {idx === 0 && <span style={{ fontSize: '1.5rem', fontWeight: '700', color: '#FFAAA5' }}>VS</span>}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* 30% area for Countdown duration settings */}
                <div className="mobile-choices-area">
                  <label style={{ fontWeight: '600', display: 'block', marginBottom: '0.3rem', fontSize: '0.9rem' }}>
                    ⏱️ Countdown Duration: {profile.id !== currentRoom.hostId && <span style={{ fontSize: '0.75rem', color: '#888', fontWeight: 'normal' }}>(Host)</span>}
                  </label>
                  <div className="countdown-options">
                    {[3, 5, 7].map(duration => {
                      const isHost = profile.id === currentRoom.hostId;
                      return (
                        <button 
                          key={duration}
                          className={`crayon-btn ${currentRoom.countdownDuration === duration ? 'crayon-btn-secondary' : ''}`}
                          style={{ 
                            padding: '0.3rem 0.6rem', 
                            fontSize: '0.85rem',
                            opacity: isHost ? 1 : 0.6,
                            cursor: isHost ? 'pointer' : 'not-allowed'
                          }}
                          onClick={() => isHost && changeCountdownDuration(duration)}
                          title={isHost ? 'Select countdown' : 'Only host can select countdown'}
                        >
                          {duration} Seconds
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 20% area for Confirm Ready / Exit Match buttons */}
                <div className="mobile-actions-area">
                  <button 
                    className={`crayon-btn crayon-btn-success ${!currentRoom.players.find(p => p.profileId === profile.id)?.confirmedReady ? 'pulse-bounce' : ''}`}
                    style={{ minWidth: '150px', padding: '0.6rem 0.8rem', fontSize: '0.95rem' }}
                    onClick={confirmLobbyReady}
                    disabled={currentRoom.players.find(p => p.profileId === profile.id)?.confirmedReady}
                  >
                    {currentRoom.players.find(p => p.profileId === profile.id)?.confirmedReady ? 'Waiting...' : 'Confirm Ready! ✊'}
                  </button>
                  <button 
                    className="crayon-btn crayon-btn-error" 
                    style={{ padding: '0.6rem 0.8rem', fontSize: '0.95rem' }}
                    onClick={exitGame}
                  >
                    Exit 🚪
                  </button>
                </div>
              </div>
            )}

            {/* COUNTDOWN EXPERIENCE */}
            {currentRoom.phase === 'countdown' && (() => {
              const myPlayer = currentRoom.players.find(p => p.profileId === profile.id);
              const oppPlayer = currentRoom.players.find(p => p.profileId !== profile.id);
              const meCommitted = myPlayer && myPlayer.moveHash !== null;
              const oppCommitted = oppPlayer && oppPlayer.moveHash !== null;
              
              let titleText = 'Quick! Make Your Choice';
              let subtitleText = 'Locked in when timer runs out!';
              if (meCommitted) {
                titleText = 'Move Locked In! 🔒';
                if (oppCommitted) {
                  subtitleText = 'Both moves secured!';
                } else {
                  subtitleText = `Waiting for ${oppPlayer ? oppPlayer.username : 'opponent'} to choose...`;
                }
              } else if (countdownNum === 0) {
                titleText = 'Time is Up!';
                if (oppCommitted) {
                  subtitleText = 'Opponent is locked in! Quick, make your choice!';
                } else {
                  subtitleText = 'Waiting for both players to lock in...';
                }
              } else {
                subtitleText = 'Select your move before the timer hits 0!';
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', flex: 1 }}>
                  
                  {/* 40% area for Heading and timer */}
                  <div className="mobile-game-area">
                    <div style={{ textAlign: 'center', marginBottom: '0.3rem' }}>
                      <h2 style={{ fontSize: '1.4rem', fontWeight: '700' }}>{titleText}</h2>
                      <p style={{ color: '#777', fontSize: '0.8rem' }}>{subtitleText}</p>
                    </div>

                    {meCommitted ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', margin: '0.5rem 0' }}>
                        <div style={{ fontSize: '3rem', animation: 'pulse-bounce 1.5s infinite' }}>🔒</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: '700', color: '#4CAF50' }}>Encrypted & Secured!</div>
                      </div>
                    ) : (
                      <div className="countdown-box" style={{ borderRadius: '15px', padding: '0.2rem' }}>
                        <div className="countdown-number" style={{ fontSize: '4.5rem' }}>{countdownNum}</div>
                      </div>
                    )}
                  </div>

                  {/* 30% area for choices cards */}
                  {!meCommitted && (
                    <div className="mobile-choices-area">
                      <div className="choice-card-container">
                        {(['rock', 'paper', 'scissors'] as const).map(move => {
                          const emoji = move === 'rock' ? '✊' : move === 'paper' ? '✋' : '✌️';
                          const color = move === 'rock' ? 'crayon-btn-secondary' : move === 'paper' ? 'crayon-btn-primary' : 'crayon-btn-lavender';
                          return (
                            <div 
                              key={move}
                              className={`choice-card crayon-card ${color} ${selectedMove === move ? 'selected' : ''}`}
                              onClick={() => handleRPSSelection(move)}
                            >
                              <div className="choice-emoji">{emoji}</div>
                              <span style={{ textTransform: 'capitalize', fontWeight: '600' }}>{move}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Status selection label bottom */}
                  <div style={{ textAlign: 'center', fontSize: '0.85rem', fontWeight: '600', paddingBottom: '0.5rem' }}>
                    {meCommitted ? 'Waiting for partner...' : (selectedMove ? `You selected: ${selectedMove.toUpperCase()}` : 'Select a move!')}
                  </div>

                </div>
              );
            })()}

            {/* PHASER REVEAL ACTION ARENA */}
            {currentRoom.phase === 'reveal' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', flex: 1 }}>
                <h3 style={{ marginBottom: '0.2rem', fontWeight: '600', fontSize: '1.1rem' }}>Battleground Clashing! ⚔️</h3>
                <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <GameArena 
                    p1Move={currentRoom.players[0].currentMove || 'rock'}
                    p2Move={currentRoom.players[1].currentMove || 'rock'}
                    winnerId={
                      currentRoom.winnerId === 'draw' ? 'draw' : 
                      currentRoom.winnerId === currentRoom.players[0].profileId ? 'p1' : 'p2'
                    }
                    p1Name={currentRoom.players[0].username}
                    p2Name={currentRoom.players[1].username}
                    p1Avatar={currentRoom.players[0].avatar}
                    p2Avatar={currentRoom.players[1].avatar}
                    viewerRole={profile.id === currentRoom.players[0].profileId ? 'p1' : 'p2'}
                    onComplete={handlePhaserAnimationComplete}
                  />
                </div>
              </div>
            )}

            {/* LOSER CHOICE CARD SELECT */}
            {currentRoom.phase === 'truth-dare-select' && (
              <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
                <div className="mobile-game-area">
                  <h2 style={{ fontSize: '1.5rem', fontWeight: '700' }}>RPS Clash Concluded!</h2>
                  <p style={{ color: '#777', marginTop: '0.2rem', fontSize: '0.85rem' }}>
                    {currentRoom.winnerId === profile.id ? 'You won the battle!' : 'You lost the battle...'}
                  </p>
                </div>

                {/* Loser Select State */}
                <div className="mobile-choices-area">
                  {currentRoom.loserId === profile.id ? (
                    <div>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.8rem' }}>
                        Choose your challenge option:
                      </h3>
                      <div className="responsive-card-group" style={{ margin: '0' }}>
                        <button 
                          className="crayon-btn crayon-btn-primary pulse-bounce" 
                          style={{ width: '120px', height: '85px', fontSize: '1.05rem', flexDirection: 'column', padding: '0.4rem' }}
                          onClick={() => selectTruthOrDare('truth')}
                        >
                          <span style={{ fontSize: '1.8rem' }}>📖</span>
                          Truth
                        </button>
                        <button 
                          className="crayon-btn crayon-btn-secondary pulse-bounce" 
                          style={{ width: '120px', height: '85px', fontSize: '1.05rem', flexDirection: 'column', padding: '0.4rem' }}
                          onClick={() => selectTruthOrDare('dare')}
                        >
                          <span style={{ fontSize: '1.8rem' }}>🎯</span>
                          Dare
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: '3rem', animation: 'float-doodle 6s infinite' }}>⏳</div>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: '500', color: '#666', marginTop: '0.5rem' }}>
                        Waiting for opponent to choose Truth or Dare... 📖/🎯
                      </h3>
                    </div>
                  )}
                </div>

                <div />
              </div>
            )}

            {/* WINNER WRITE PROMPT / LOSER WAITING */}
            {currentRoom.phase === 'truth-dare-input' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', textAlign: 'center', height: '100%' }}>
                
                {/* Winner Inputs the Question/Dare */}
                {currentRoom.winnerId === profile.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', flex: 1 }}>
                    {currentRoom.actionPrompt ? (
                      <div className="mobile-game-area" style={{ height: '80%' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✉️</div>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: '600' }}>Challenge Sent!</h3>
                        <p style={{ color: '#666', marginTop: '0.2rem', fontSize: '0.85rem' }}>Waiting for response...</p>
                      </div>
                    ) : (
                      <>
                        <div className="mobile-game-area">
                          <h2 style={{ fontSize: '1.4rem', fontWeight: '700', marginBottom: '0.2rem' }}>
                            Challenge Option Chosen: {currentRoom.selectedAction?.toUpperCase()}
                          </h2>
                          <h3 style={{ fontSize: '1.1rem', fontWeight: '600' }}>
                            Write a {currentRoom.selectedAction} challenge for your opponent:
                          </h3>
                        </div>

                        {challengeTimer !== null && (
                          <div className="countdown-box" style={{ background: 'none', height: 'auto', marginBottom: '0.5rem' }}>
                            <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#6A6660' }}>Time Remaining</div>
                            <div className="countdown-number" style={{ fontSize: '2.5rem', animation: 'none', color: '#FF6F59' }}>
                              {challengeTimer}
                            </div>
                          </div>
                        )}

                        <div className="mobile-choices-area">
                          <textarea 
                            className="crayon-input"
                            rows={2}
                            placeholder={
                              currentRoom.selectedAction === 'truth' 
                                ? 'e.g., What is your most embarrassing memory?' 
                                : 'e.g., Sing the chorus of your favorite song out loud!'
                            }
                            value={truthDarePrompt}
                            onChange={e => setTruthDarePrompt(e.target.value)}
                            style={{ resize: 'none', width: '90%', fontSize: '0.9rem' }}
                          />
                        </div>
                        <div className="mobile-actions-area">
                          <button className="crayon-btn crayon-btn-success" style={{ padding: '0.5rem 1rem', fontSize: '0.95rem' }} onClick={submitTruthDarePrompt} disabled={!truthDarePrompt.trim()}>
                            Send Challenge 🚀
                          </button>
                          <button className="crayon-btn crayon-btn-error" style={{ padding: '0.5rem 1rem', fontSize: '0.95rem' }} onClick={handleSkipAction}>
                            Skip
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  // Loser waits for the prompt
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', flex: 1 }}>
                    {currentRoom.actionPrompt ? (
                      <>
                        <div className="mobile-game-area">
                          <h2 style={{ fontSize: '1.4rem', fontWeight: '700', marginBottom: '0.2rem' }}>
                            Challenge Option Chosen: {currentRoom.selectedAction?.toUpperCase()}
                          </h2>
                          <div className="crayon-border-thin" style={{ padding: '0.4rem', backgroundColor: '#FFF7E8', width: '95%' }}>
                            <h4 style={{ color: '#FF6F59', fontWeight: '700', fontSize: '0.9rem', marginBottom: '0.1rem' }}>
                              YOUR CHALLENGE:
                            </h4>
                            <p style={{ fontSize: '1rem', fontWeight: '600', color: '#4A4640' }}>
                              "{currentRoom.actionPrompt}"
                            </p>
                          </div>
                        </div>

                        <div className="mobile-choices-area" style={{ height: '40%', justifyContent: 'flex-start' }}>
                          <textarea
                            className="crayon-input"
                            rows={2}
                            placeholder="Type your answer / response here..."
                            value={truthDareResponse}
                            onChange={e => setTruthDareResponse(e.target.value)}
                            style={{ resize: 'none', width: '95%', fontSize: '0.9rem', marginBottom: '0.2rem' }}
                          />

                          {currentRoom.selectedAction === 'dare' && (
                            <div className="crayon-border-thin" style={{ padding: '0.4rem', backgroundColor: '#FFFDF9', borderRadius: '8px', width: '95%' }}>
                              <h4 style={{ fontWeight: '700', fontSize: '0.8rem', marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#4A4640' }}>
                                📷 Add Dare Proof (Optional)
                              </h4>
                              
                              {/* Preview Area */}
                              {proofPreviewUrl ? (
                                <div style={{ position: 'relative', textAlign: 'center', backgroundColor: '#000', borderRadius: '6px', overflow: 'hidden', minHeight: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {proofType === 'image' ? (
                                    <img src={proofPreviewUrl} alt="Proof preview" style={{ maxWidth: '100%', maxHeight: '80px', objectFit: 'contain' }} />
                                  ) : (
                                    <video src={proofPreviewUrl} controls style={{ maxWidth: '100%', maxHeight: '80px' }} />
                                  )}
                                  <button 
                                    onClick={clearProofMedia} 
                                    style={{ position: 'absolute', top: '2px', right: '2px', backgroundColor: 'rgba(255, 0, 0, 0.8)', color: 'white', border: 'none', borderRadius: '50%', width: '18px', height: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '0.7rem' }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : null}

                              {/* Camera Stream Area */}
                              {isCapturing && (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                                  <div style={{ position: 'relative', width: '100%', maxWidth: '160px', borderRadius: '6px', overflow: 'hidden', backgroundColor: '#000' }}>
                                    <video ref={cameraVideoRef} autoPlay playsInline muted style={{ width: '100%', display: 'block' }} />
                                    {isRecordingVideo && (
                                      <div style={{ position: 'absolute', top: '2px', left: '2px', display: 'flex', alignItems: 'center', gap: '0.2rem', backgroundColor: 'rgba(255,0,0,0.8)', padding: '0.1rem 0.3rem', borderRadius: '4px', color: 'white', fontSize: '0.7rem', fontWeight: '700' }}>
                                        <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'red', display: 'inline-block', marginRight: '2px' }}></span>
                                        REC {videoTimer}s
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: '0.2rem' }}>
                                    {!isRecordingVideo ? (
                                      <>
                                        <button className="crayon-btn" style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }} onClick={capturePhoto}>
                                          📸 Photo
                                        </button>
                                        <button className="crayon-btn" style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }} onClick={startRecording}>
                                          🎥 Video
                                        </button>
                                      </>
                                    ) : (
                                      <button className="crayon-btn crayon-btn-error" style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }} onClick={stopRecording}>
                                        Stop
                                      </button>
                                    )}
                                    <button className="crayon-btn" style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }} onClick={stopCamera}>
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Options buttons */}
                              {!proofPreviewUrl && !isCapturing && (
                                <div style={{ display: 'flex', gap: '0.3rem' }}>
                                  <button 
                                    className="crayon-btn crayon-btn-lavender" 
                                    style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem', flex: 1, textAlign: 'center' }} 
                                    onClick={startCamera}
                                  >
                                    📷 Camera
                                  </button>
                                  
                                  <label 
                                    className="crayon-btn crayon-btn-primary" 
                                    style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem', flex: 1, textAlign: 'center', cursor: 'pointer' }}
                                  >
                                    📁 Upload
                                    <input 
                                      type="file" 
                                      accept="image/*,video/*" 
                                      style={{ display: 'none' }} 
                                      onChange={handleFileSelect}
                                    />
                                  </label>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="mobile-actions-area">
                          <button className="crayon-btn crayon-btn-success" style={{ padding: '0.5rem 1rem', fontSize: '0.95rem' }} onClick={submitTruthDareResponse} disabled={!truthDareResponse.trim() && !proofPreviewUrl}>
                            Submit ✍️
                          </button>
                          <button className="crayon-btn crayon-btn-error" style={{ padding: '0.5rem 1rem', fontSize: '0.95rem' }} onClick={handleSkipAction}>
                            Skip
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="mobile-game-area" style={{ height: '80%' }}>
                        <div style={{ fontSize: '3.5rem', animation: 'float-doodle 6s infinite' }}>✏️</div>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: '500', color: '#666', marginTop: '0.5rem' }}>
                          Winner is writing challenge...
                        </h3>
                      </div>
                    )}
                  </div>
                )}

                <div />
              </div>
            )}

            {/* REVEAL COMPLETED RESPONSE */}
            {currentRoom.phase === 'truth-dare-reveal' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', textAlign: 'center' }}>
                
                {/* 42% area for Header and challenge prompt */}
                <div className="mobile-game-area">
                  <h2 style={{ fontSize: '1.4rem', fontWeight: '700', color: '#52D681', marginBottom: '0.2rem' }}>Challenge Fulfilled! 🎉</h2>
                  <div className="crayon-border-thin" style={{ padding: '0.5rem', backgroundColor: '#F9F8F5', width: '95%' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#777', textTransform: 'uppercase' }}>
                      The Challenge ({currentRoom.selectedAction}):
                    </div>
                    <div style={{ fontSize: '0.95rem', fontWeight: '600', marginTop: '0.1rem' }}>
                      "{currentRoom.actionPrompt}"
                    </div>
                  </div>
                </div>

                {/* 33% area for Response answer text / proof folder click */}
                <div className="mobile-choices-area">
                  <div className="crayon-card" style={{ padding: '0.6rem', backgroundColor: '#FFF7E8', position: 'relative', width: '95%' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#FFA048', textTransform: 'uppercase' }}>
                      The Response:
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', marginTop: '0.1rem', color: '#4A4640' }}>
                      "{currentRoom.actionResponse}"
                    </div>

                    {currentRoom.actionProofMedia && (
                      <div 
                        style={{ position: 'absolute', top: '2px', right: '2px', cursor: 'pointer', zIndex: 10 }}
                        onClick={() => setShowProofPreview(true)}
                        title="Click to view Dare proof media!"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100" width="30" height="25">
                          <path d="M10,22 C10,18 13,15 17,15 L65,15 C68,15 70,17 72,20 L77,28 L105,28 C109,28 112,31 112,35 L112,85 C112,89 109,92 105,92 L17,92 C13,92 10,89 10,85 Z" fill="#C62828" stroke="#000000" stroke-width="6" stroke-linejoin="round" />
                          <path d="M8,30 C8,26 11,23 15,23 L107,23 C111,23 114,26 114,30 L114,87 C114,91 111,94 107,94 L15,94 C11,94 8,91 8,87 Z" fill="#E53935" stroke="#000000" stroke-width="6" stroke-linejoin="round" />
                          <circle cx="60" cy="58" r="18" fill="#FFFFFF" stroke="#000000" stroke-width="5" />
                          <polygon points="54,48 72,58 54,68" fill="#E53935" stroke="#000000" stroke-width="3" stroke-linejoin="round" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>

                {/* 20% area for Continue action button */}
                <div className="mobile-actions-area">
                  <button className="crayon-btn crayon-btn-primary" style={{ padding: '0.6rem 1rem', fontSize: '0.95rem' }} onClick={handleGotoPostRound}>
                    Continue to Lobby ➔
                  </button>
                </div>

                {/* PROOF PREVIEW OVERLAY MODAL */}
                {showProofPreview && currentRoom?.actionProofMedia && (
                  <div 
                    style={{ 
                      position: 'fixed', 
                      top: 0, 
                      left: 0, 
                      right: 0, 
                      bottom: 0, 
                      backgroundColor: 'rgba(0,0,0,0.85)', 
                      display: 'flex', 
                      flexDirection: 'column', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      zIndex: 2000, 
                      padding: '1rem' 
                    }}
                    onClick={() => setShowProofPreview(false)}
                  >
                    <div 
                      className="crayon-card" 
                      style={{ 
                        backgroundColor: '#FFF7E8', 
                        padding: '1rem', 
                        maxWidth: '95%', 
                        maxHeight: '95%', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'center', 
                        gap: '0.5rem',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
                        position: 'relative'
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                      <button 
                        onClick={() => setShowProofPreview(false)}
                        className="crayon-btn crayon-btn-error"
                        style={{ 
                          position: 'absolute', 
                          top: '5px', 
                          right: '5px', 
                          padding: '0.2rem', 
                          borderRadius: '50%',
                          width: '28px',
                          height: '28px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: '700',
                          fontSize: '0.8rem'
                        }}
                      >
                        ✕
                      </button>

                      <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#4A4640', width: '100%', textAlign: 'center', paddingRight: '1.5rem' }}>
                        Dare Completion Proof 🎥
                      </h3>

                      <div style={{ borderRadius: '6px', overflow: 'hidden', border: '3px solid #4A4640', backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', maxWidth: '100%', maxHeight: '50vh' }}>
                        {currentRoom.actionProofType === 'video' ? (
                          <video 
                            src={currentRoom.actionProofMedia} 
                            controls 
                            autoPlay 
                            loop 
                            style={{ maxWidth: '100%', maxHeight: '48vh', display: 'block' }} 
                          />
                        ) : (
                          <img 
                            src={currentRoom.actionProofMedia} 
                            alt="Dare proof submission" 
                            style={{ maxWidth: '100%', maxHeight: '48vh', objectFit: 'contain', display: 'block' }} 
                          />
                        )}
                      </div>

                      <button 
                        className="crayon-btn crayon-btn-primary" 
                        onClick={() => setShowProofPreview(false)}
                        style={{ width: '120px', padding: '0.4rem', fontSize: '0.85rem' }}
                      >
                        Close Preview
                      </button>
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* POST-ROUND REMATCH LOBBY */}
            {currentRoom.phase === 'post-round' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', textAlign: 'center' }}>
                
                {/* 42% area for Score summary */}
                <div className="mobile-game-area">
                  <div>
                    <h2 style={{ fontSize: '1.4rem', fontWeight: '700', marginBottom: '0.1rem' }}>Match Concluded!</h2>
                    <p style={{ color: '#777', fontSize: '0.8rem' }}>Do you want a rematch or exit back?</p>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', alignItems: 'center', margin: '0.4rem 0' }}>
                    {currentRoom.players.map((p, idx) => (
                      <React.Fragment key={p.profileId}>
                        <div className="crayon-border-thin" style={{ padding: '0.4rem', width: '95px' }}>
                          <div style={{ fontSize: '2rem' }}>{p.avatar}</div>
                          <h4 style={{ fontWeight: '700', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.username}</h4>
                          <div style={{ fontSize: '1.3rem', fontWeight: '700', color: '#4A4640', marginTop: '0.1rem' }}>
                            {p.score}
                          </div>
                        </div>
                        {idx === 0 && <span style={{ fontSize: '1.2rem', fontWeight: '700', color: '#777' }}>VS</span>}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* 20% area for rematch / exit buttons */}
                <div className="mobile-actions-area" style={{ height: '35% !important', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <button 
                    className="crayon-btn crayon-btn-success" 
                    onClick={requestRematch}
                    disabled={currentRoom.rematchRequests.includes(profile.id)}
                    style={{ padding: '0.5rem 0.8rem', fontSize: '0.9rem' }}
                  >
                    {currentRoom.rematchRequests.includes(profile.id) ? 'Rematch Requested...' : 'Request Rematch 🔄'}
                  </button>

                  {/* Add Friend Trigger */}
                  {!profile.friends.includes(
                    currentRoom.players.find(p => p.profileId !== profile.id)?.profileId || ''
                  ) && (
                    <button 
                      className="crayon-btn crayon-btn-lavender" 
                      onClick={() => quickAddFriend(currentRoom.players.find(p => p.profileId !== profile.id)?.profileId || '')}
                      style={{ padding: '0.5rem 0.8rem', fontSize: '0.9rem' }}
                    >
                      <UserPlus size={14} /> Add Friend
                    </button>
                  )}

                  <button className="crayon-btn crayon-btn-error" onClick={exitGame} style={{ padding: '0.5rem 0.8rem', fontSize: '0.9rem' }}>
                    Exit 🚪
                  </button>
                </div>

              </div>
            )}

          </div>

          {/* Mobile Chat Floating Button */}
          {isMobileView && (
            <div className="mobile-chat-trigger-container">
              <button 
                className="crayon-btn mobile-chat-trigger-btn"
                onClick={() => toggleMobileChat(!isMobileChatOpen)}
              >
                <MessageSquare size={24} />
                {unreadCount > 0 && (
                  <span className="mobile-chat-red-dot">
                    {unreadCount > 1 ? unreadCount : ''}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Mobile Chat Drawer Overlay */}
          {isMobileView && isMobileChatOpen && (
            <div className="mobile-chat-drawer-overlay" onClick={() => toggleMobileChat(false)}>
              <div className="mobile-chat-drawer-content crayon-card animate-slide-up" onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px dashed #ccc', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '1.1rem' }}>
                    <MessageSquare size={16} /> Lobby Chat
                  </h3>
                  <button type="button" className="mobile-chat-close-btn" style={{ display: 'block' }} onClick={() => toggleMobileChat(false)}>✕</button>
                </div>
                
                <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                  <ChatMessagesList chatHistory={currentRoom.chatHistory} players={currentRoom.players} myProfileId={profile.id} />
                  <div ref={chatBottomRef} />
                </div>

                <form onSubmit={submitChatMessage} className="chat-input-area">
                  <input 
                    type="text" 
                    className="crayon-input"
                    placeholder="Say hello... 👋" 
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                  />
                  <button type="submit" className="crayon-btn crayon-btn-primary" style={{ padding: '0.6rem 0.9rem' }}>
                    <Send size={16} />
                  </button>
                </form>
              </div>
            </div>
          )}

        </div>
      )}



      {/* FOOTER STATS INFO */}
      {screen !== 'game' && (
        <footer className="game-footer">
          &copy; {new Date().getFullYear()} Truth or Dare Arena. Created with ❤️ for local social play.
        </footer>
      )}

      {/* MODALS */}

      {/* 1. STATISTICS & BADGES MODAL */}
      {showProfileModal && profile && (
        <div className="modal-overlay" onClick={() => setShowProfileModal(false)}>
          <div className="modal-content crayon-card" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px dashed #4A4640', paddingBottom: '0.8rem', marginBottom: '1rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.4rem' }}>
                <Trophy size={24} color="#FFA048" /> Player Statistics
              </h2>
              <button className="crayon-btn" style={{ padding: '0.3rem', minWidth: '32px' }} onClick={() => setShowProfileModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '4rem', padding: '0.5rem', border: '3px solid #333', borderRadius: '15px', backgroundColor: '#FFF7E8' }}>
                {profile.avatar}
              </div>
              <div>
                <h3 style={{ fontSize: '1.3rem' }}>{profile.username}</h3>
                <p style={{ color: '#777', fontSize: '0.85rem' }}>ID: {profile.id}</p>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem' }}>
                  <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.4rem', backgroundColor: '#FFE38A', border: '1px solid #444', borderRadius: '4px', fontWeight: '600' }}>
                    Title: {profile.currentTitle}
                  </span>
                  <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.4rem', backgroundColor: '#8FE3D4', border: '1px solid #444', borderRadius: '4px', fontWeight: '600' }}>
                    Level {profile.level} (XP: {profile.xp})
                  </span>
                  <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.4rem', backgroundColor: '#FFAAA5', border: '1px solid #444', borderRadius: '4px', fontWeight: '700' }}>
                    Rank: {profile.rank || '🥉 Bronze'}
                  </span>
                </div>
              </div>
            </div>

            {/* General Counters */}
            <div className="menu-grid" style={{ marginBottom: '1.5rem' }}>
              <div className="crayon-border-thin" style={{ padding: '0.8rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: '700' }}>{profile.gamesPlayed}</div>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>Games Played</div>
              </div>
              <div className="crayon-border-thin" style={{ padding: '0.8rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: '700' }}>{profile.wins}</div>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>Wins</div>
              </div>
              <div className="crayon-border-thin" style={{ padding: '0.8rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: '700' }}>{profile.truthCompleted}</div>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>Truths Told</div>
              </div>
              <div className="crayon-border-thin" style={{ padding: '0.8rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: '700' }}>{profile.daresCompleted}</div>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>Dares Done</div>
              </div>
            </div>

            {/* Achievements Section */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ borderBottom: '2px dashed #ccc', paddingBottom: '0.3rem', marginBottom: '0.6rem', fontWeight: '600' }}>
                🏆 Achievement Badges
              </h4>
              {profile.achievements.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                  {profile.achievements.map((badge, idx) => {
                    let icon = '⭐️';
                    if (badge === 'First Win') icon = '🥇';
                    if (badge === 'RPS Expert') icon = '🧙‍♂️';
                    if (badge === 'Truth Teller') icon = '📖';
                    if (badge === 'Dare Devil') icon = '👹';
                    if (badge === 'On Fire') icon = '🔥';
                    return (
                      <div key={idx} className="achievement-badge">
                        <span className="achievement-icon">{icon}</span>
                        <span>{badge}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ fontSize: '0.85rem', color: '#888', fontStyle: 'italic' }}>
                  No achievements unlocked yet. Play rounds to earn badges!
                </p>
              )}
            </div>

            {/* Match History */}
            <div>
              <h4 style={{ borderBottom: '2px dashed #ccc', paddingBottom: '0.3rem', marginBottom: '0.6rem', fontWeight: '600' }}>
                📜 Match History (Last 10 Rounds)
              </h4>
              {profile.matchHistory && profile.matchHistory.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {profile.matchHistory.map((m, idx) => (
                    <div 
                      key={idx} 
                      className="crayon-border-thin" 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        padding: '0.4rem 0.8rem', 
                        fontSize: '0.85rem',
                        backgroundColor: m.result === 'win' ? '#EBFBEE' : m.result === 'loss' ? '#FFF0F0' : '#FFFBEB'
                      }}
                    >
                      <span style={{ fontWeight: '600' }}>
                        {m.result.toUpperCase()} vs {m.opponentName}
                      </span>
                      <span style={{ color: '#777' }}>{m.date}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: '0.85rem', color: '#888', fontStyle: 'italic' }}>
                  No matches logged. Play a game to record logs!
                </p>
              )}
            </div>

          </div>
        </div>
      )}

      {/* 2. EDIT PROFILE SETTINGS MODAL */}
      {showSettingsModal && profile && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-content crayon-card" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px dashed #4A4640', paddingBottom: '0.8rem', marginBottom: '1.2rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.3rem' }}>
                <Settings size={20} /> Edit Player Profile
              </h2>
              <button className="crayon-btn" style={{ padding: '0.3rem', minWidth: '32px' }} onClick={() => setShowSettingsModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              
              {/* Username input */}
              <div>
                <label style={{ fontWeight: '600', display: 'block', marginBottom: '0.4rem', fontSize: '0.95rem' }}>
                  ✏️ Edit Username:
                </label>
                <input 
                  type="text" 
                  className="crayon-input"
                  value={usernameInput}
                  onChange={e => setUsernameInput(e.target.value)}
                  maxLength={16}
                />
              </div>

              {/* Avatar Picker */}
              <div>
                <label style={{ fontWeight: '600', display: 'block', marginBottom: '0.4rem', fontSize: '0.95rem' }}>
                  🦊 Choose Avatar Icon:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem', maxHeight: '150px', overflowY: 'auto', padding: '0.3rem', border: '2px solid #ccc', borderRadius: '10px' }}>
                  {AVATARS.map((avatar, idx) => (
                    <button
                      key={idx}
                      className="crayon-border-thin"
                      style={{ 
                        fontSize: '2rem', 
                        padding: '0.3rem', 
                        backgroundColor: selectedAvatar === avatar ? '#A8D1FF' : '#ffffff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      onClick={() => setSelectedAvatar(avatar)}
                    >
                      {avatar}
                    </button>
                  ))}
                </div>
              </div>

              {/* Save */}
              <div style={{ display: 'flex', gap: '0.8rem', marginTop: '0.5rem' }}>
                <button className="crayon-btn crayon-btn-success" style={{ flex: 1 }} onClick={saveSettings} disabled={!usernameInput.trim()}>
                  Save Details
                </button>
                <button className="crayon-btn" style={{ flex: 1 }} onClick={() => setShowSettingsModal(false)}>
                  Cancel
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* 3. RECENT FRIENDS MODAL */}
      {showFriendsModal && profile && (
        <div className="modal-overlay" onClick={() => setShowFriendsModal(false)}>
          <div className="modal-content crayon-card" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px dashed #4A4640', paddingBottom: '0.8rem', marginBottom: '1.2rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.3rem' }}>
                <Users size={20} /> Recent Played
              </h2>
              <button className="crayon-btn" style={{ padding: '0.3rem', minWidth: '32px' }} onClick={() => setShowFriendsModal(false)}>
                <X size={16} />
              </button>
            </div>

            {/* List of Recent Opponents */}
            <div>
              <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '1rem' }}>
                Below are the players you clashed with in your last matches. Click the sword ⚔️ button to invite them again!
              </p>
              {getRecentOpponents().length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '250px', overflowY: 'auto' }}>
                  {getRecentOpponents().map((opp, idx) => (
                    <div 
                      key={idx} 
                      className="crayon-border-thin" 
                      style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        padding: '0.6rem 1rem', 
                        backgroundColor: '#ffffff'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ fontSize: '1.6rem' }}>👤</span>
                        <div>
                          <div style={{ fontWeight: '700', fontSize: '0.95rem' }}>{opp.name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#777' }}>ID: {opp.id}</div>
                          <span style={{ fontSize: '0.70rem', padding: '0.05rem 0.3rem', backgroundColor: '#FFE38A', border: '1px solid #444', borderRadius: '3px', fontWeight: '600', display: 'inline-block', marginTop: '0.15rem' }}>
                            RECENT PLAYED
                          </span>
                        </div>
                      </div>
                      <button 
                        className="crayon-btn crayon-btn-secondary" 
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem', minWidth: 'auto' }}
                        onClick={() => {
                          handleButtonClick();
                          socketRef.current?.emit('send-match-invite', {
                            senderId: profile.id,
                            targetId: opp.id
                          });
                          alert(`Match invite sent to ${opp.name} (${opp.id})!`);
                          setShowFriendsModal(false);
                        }}
                      >
                        Invite ⚔️
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: '0.85rem', color: '#888', fontStyle: 'italic', textAlign: 'center', padding: '1.5rem' }}>
                  You haven't played any matches yet. Play matchmaking rounds to log recent opponents!
                </p>
              )}
            </div>

          </div>
        </div>
      )}

      {/* 4. PLAY WITH FRIEND MATCH INVITE MODAL */}
      {showInviteModal && profile && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="modal-content crayon-card" style={{ maxWidth: '380px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px dashed #4A4640', paddingBottom: '0.8rem', marginBottom: '1.2rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.3rem' }}>
                ⚔️ Play With Friend
              </h2>
              <button className="crayon-btn" style={{ padding: '0.3rem', minWidth: '32px' }} onClick={() => setShowInviteModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <p style={{ fontSize: '0.9rem', color: '#666' }}>
                Enter your friend's Player ID below to send them an instant match invitation. They must be logged in online!
              </p>

              <div>
                <label style={{ fontWeight: '600', display: 'block', marginBottom: '0.4rem', fontSize: '0.95rem' }}>
                  🔑 Friend Player ID:
                </label>
                <input 
                  type="text" 
                  className="crayon-input"
                  placeholder="e.g. TRUTH-4567"
                  value={inviteFriendId}
                  onChange={e => setInviteFriendId(e.target.value)}
                />
                {inviteError && (
                  <div style={{ color: 'red', fontSize: '0.8rem', marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <AlertCircle size={12} /> {inviteError}
                  </div>
                )}
                {inviteStatus && (
                  <div 
                    style={{ 
                      fontSize: '0.85rem', 
                      marginTop: '0.5rem', 
                      padding: '0.5rem', 
                      borderRadius: '5px',
                      backgroundColor: inviteStatus.type === 'success' ? '#EBFBEE' : '#FFF0F0',
                      border: `1px solid ${inviteStatus.type === 'success' ? '#A7E8C5' : '#FFAAA5'}`,
                      color: inviteStatus.type === 'success' ? '#2F855A' : '#C53030'
                    }}
                  >
                    {inviteStatus.message}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.8rem' }}>
                <button className="crayon-btn crayon-btn-secondary" style={{ flex: 1 }} onClick={sendFriendInvite} disabled={!inviteFriendId.trim()}>
                  Send Match Invite
                </button>
                <button className="crayon-btn" style={{ flex: 1 }} onClick={() => setShowInviteModal(false)}>
                  Cancel
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* 5. MATCH INVITATIONS LIST MODAL */}
      {showInvitationsModal && (
        <div className="modal-overlay" onClick={() => setShowInvitationsModal(false)}>
          <div className="modal-content crayon-card" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px dashed #4A4640', paddingBottom: '0.8rem', marginBottom: '1.2rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.3rem' }}>
                ✉️ Match Invitations
              </h2>
              <button className="crayon-btn" style={{ padding: '0.3rem', minWidth: '32px' }} onClick={() => setShowInvitationsModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', maxHeight: '380px', overflowY: 'auto' }}>
              {/* Active invitations */}
              <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#4A4640', borderBottom: '2px dashed #4A4640', paddingBottom: '0.3rem' }}>
                Active Invitations
              </h3>
              {activeInvites.length > 0 ? (
                activeInvites.map((inv) => (
                  <div 
                    key={inv.id} 
                    className="crayon-border-thin" 
                    style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      padding: '0.6rem 1rem', 
                      backgroundColor: '#ffffff'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                      <span style={{ fontSize: '2rem' }}>{inv.avatar}</span>
                      <div>
                        <div style={{ fontWeight: '700', fontSize: '0.95rem' }}>{inv.username}</div>
                        <div style={{ fontSize: '0.75rem', color: '#FF6F59', fontWeight: '700' }}>Expires in {inv.timeLeft}s</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button 
                        className="crayon-btn crayon-btn-success" 
                        style={{ padding: '0.35rem 0.6rem', minWidth: 'auto', fontSize: '1.1rem' }}
                        onClick={() => {
                          acceptIncomingInvite(inv.id);
                          setShowInvitationsModal(false);
                        }}
                      >
                        ✅
                      </button>
                      <button 
                        className="crayon-btn crayon-btn-error" 
                        style={{ padding: '0.35rem 0.6rem', minWidth: 'auto', fontSize: '1.1rem' }}
                        onClick={() => {
                          declineIncomingInvite(inv.id);
                          setActiveInvites(prev => prev.filter(i => i.id !== inv.id));
                        }}
                      >
                        ❌
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p style={{ fontSize: '0.85rem', color: '#777', fontStyle: 'italic', textAlign: 'center', padding: '0.8rem' }}>
                  No active match invitations.
                </p>
              )}

              {/* Recent expired invitations */}
              {recentInvites.length > 0 && (
                <div style={{ marginTop: '0.8rem', borderTop: '3px dashed #4A4640', paddingTop: '0.8rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: '700', color: '#666', marginBottom: '0.5rem' }}>
                    Recent Invitations
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {recentInvites.map((inv) => (
                      <div 
                        key={inv.id} 
                        className="crayon-border-thin" 
                        style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center',
                          padding: '0.5rem 0.8rem', 
                          backgroundColor: '#F3F4F6',
                          opacity: 0.85
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span style={{ fontSize: '1.8rem' }}>{inv.avatar}</span>
                          <div>
                            <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#4A4640' }}>{inv.username}</div>
                            <span style={{ fontSize: '0.65rem', color: '#999', fontWeight: '700', backgroundColor: '#E5E7EB', padding: '0.1rem 0.3rem', borderRadius: '4px' }}>
                              RECENT INVITION
                            </span>
                          </div>
                        </div>
                        <button 
                          className="crayon-btn crayon-btn-primary" 
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                          onClick={() => {
                            handleButtonClick();
                            setInviteFriendId(inv.id);
                            setShowInvitationsModal(false);
                            setShowInviteModal(true);
                          }}
                        >
                          Invite Back 🔄
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pop-up notifications list on the right side */}
      <div style={{ position: 'fixed', top: '20px', right: '20px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 9999, pointerEvents: 'none' }}>
        {activeInvites.map(invite => (
          <div 
            key={invite.id} 
            className="crayon-card" 
            style={{ 
              pointerEvents: 'auto', 
              width: '280px', 
              padding: '1rem', 
              backgroundColor: '#FFF7E8', 
              border: '3px solid #4A4640',
              boxShadow: '-4px 4px 0px #4A4640',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              animation: 'bounce-in 0.3s ease-out'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '2rem' }}>{invite.avatar}</span>
              <div style={{ flex: 1 }}>
                <h4 style={{ fontWeight: '700', fontSize: '0.95rem', color: '#4A4640', margin: 0 }}>{invite.username}</h4>
                <p style={{ fontSize: '0.75rem', color: '#666', margin: 0 }}>Invited you to play!</p>
              </div>
              <div style={{ 
                width: '32px', 
                height: '32px', 
                borderRadius: '50%', 
                border: '2px solid #FF6F59', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                fontWeight: '700', 
                fontSize: '0.85rem', 
                color: '#FF6F59',
                backgroundColor: '#FFF0ED',
                flexShrink: 0
              }}>
                {invite.timeLeft}s
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.2rem' }}>
              <button 
                className="crayon-btn crayon-btn-success" 
                style={{ flex: 1, padding: '0.3rem', fontSize: '0.8rem' }}
                onClick={() => {
                  acceptIncomingInvite(invite.id);
                  setActiveInvites(prev => prev.filter(i => i.id !== invite.id));
                }}
              >
                Accept ✅
              </button>
              <button 
                className="crayon-btn crayon-btn-error" 
                style={{ flex: 1, padding: '0.3rem', fontSize: '0.8rem' }}
                onClick={() => {
                  declineIncomingInvite(invite.id);
                  setActiveInvites(prev => prev.filter(i => i.id !== invite.id));
                }}
              >
                Decline ❌
              </button>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
