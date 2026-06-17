export interface MatchHistoryEntry {
  matchId: string;
  opponentId: string;
  opponentName: string;
  date: string;
  result: 'win' | 'loss' | 'draw';
  rounds: number;
}

export interface PlayerProfile {
  id: string;
  username: string;
  avatar: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  truthCompleted: number;
  daresCompleted: number;
  winPercentage: number;
  xp: number;
  level: number;
  currentTitle: string;
  activeStreak: number;
  friends: string[]; // List of Friend Player IDs
  matchHistory: MatchHistoryEntry[];
  achievements: string[];
  rank: string;
}
