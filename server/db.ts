import fs from 'fs';
import path from 'path';
import { MongoClient, Db } from 'mongodb';
import { PlayerProfile, MatchHistoryEntry } from '../src/types';

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = 'truth_dare_arena';
const LOCAL_DB_PATH = path.join(process.cwd(), 'server', 'db.json');

let dbClient: MongoClient | null = null;
let mongoDb: Db | null = null;
let isMongo = false;

// Mock / Initial DB data format
interface LocalSchema {
  players: Record<string, PlayerProfile>;
}

// Pre-fill local db cache
let localCache: LocalSchema = { players: {} };

// Ensure server directory exists
const serverDir = path.join(process.cwd(), 'server');
if (!fs.existsSync(serverDir)) {
  fs.mkdirSync(serverDir, { recursive: true });
}

// Load local database file
function loadLocalDb(): LocalSchema {
  try {
    if (fs.existsSync(LOCAL_DB_PATH)) {
      const content = fs.readFileSync(LOCAL_DB_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Error reading local db.json, resetting database.', err);
  }
  return { players: {} };
}

// Save local database file
function saveLocalDb() {
  try {
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(localCache, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write local db.json', err);
  }
}

// Connect to Database
export async function connectDb() {
  if (MONGO_URI) {
    try {
      console.log('Connecting to MongoDB...');
      dbClient = new MongoClient(MONGO_URI);
      await dbClient.connect();
      mongoDb = dbClient.db(DB_NAME);
      isMongo = true;
      console.log('Successfully connected to MongoDB.');
      return;
    } catch (err) {
      console.warn('MongoDB connection failed. Falling back to local db.json file storage.', err);
    }
  } else {
    console.log('No MONGODB_URI provided. Initializing local db.json file storage.');
  }

  // Set up local file DB fallback
  localCache = loadLocalDb();
  isMongo = false;
}

// Default Avatar generators
const AVATARS = [
  '🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🦁', '🐮', '🐷', '🐸', 
  '🐵', '🐔', '🐧', '🦆', '🦉', '🦖', '🦄', '🐝', '🐙', '🎨'
];

const TITLES = [
  'Rookie',
  'Lucky Winner',
  'RPS Champion',
  'Mind Reader',
  'Truth Master',
  'Dare King'
];

export function calculateRank(wins: number): string {
  if (wins >= 100) return '🏆 Legend';
  if (wins >= 75) return '👑 Master';
  if (wins >= 50) return '💠 Diamond';
  if (wins >= 30) return '💎 Platinum';
  if (wins >= 15) return '🥇 Gold';
  if (wins >= 5) return '🥈 Silver';
  return '🥉 Bronze';
}

function generateGuestPlayer(id: string): PlayerProfile {
  const digits = id.split('-')[1] || '0000';
  const randomAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  return {
    id,
    username: `Player-${digits}`,
    avatar: randomAvatar,
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
}

export async function getPlayerProfile(id: string): Promise<PlayerProfile> {
  if (isMongo && mongoDb) {
    const col = mongoDb.collection<any>('players');
    let profile = await col.findOne({ id });
    if (!profile) {
      profile = generateGuestPlayer(id);
      await col.insertOne(profile);
    }
    return profile;
  } else {
    if (!localCache.players[id]) {
      localCache.players[id] = generateGuestPlayer(id);
      saveLocalDb();
    }
    return localCache.players[id];
  }
}

export async function updatePlayerProfile(id: string, updates: Partial<PlayerProfile>): Promise<PlayerProfile> {
  const profile = await getPlayerProfile(id);
  const updated = { ...profile, ...updates };
  
  // Calculate win percentage
  const total = updated.wins + updated.losses;
  updated.winPercentage = total > 0 ? Math.round((updated.wins / total) * 100) : 0;
  
  // XP to Level formula: level = floor(sqrt(xp / 100)) + 1
  updated.level = Math.floor(Math.sqrt(updated.xp / 100)) + 1;
  
  // Update Rank
  updated.rank = calculateRank(updated.wins);

  // Achievement Checkers
  const achievements = [...updated.achievements];
  if (updated.wins >= 1 && !achievements.includes('First Win')) achievements.push('First Win');
  if (updated.wins >= 10 && !achievements.includes('RPS Expert')) achievements.push('RPS Expert');
  if (updated.truthCompleted >= 5 && !achievements.includes('Truth Teller')) achievements.push('Truth Teller');
  if (updated.daresCompleted >= 5 && !achievements.includes('Dare Devil')) achievements.push('Dare Devil');
  if (updated.activeStreak >= 3 && !achievements.includes('On Fire')) achievements.push('On Fire');
  updated.achievements = achievements;

  // Title suggestions based on milestones
  if (updated.wins >= 15 && !TITLES.includes(updated.currentTitle)) {
    updated.currentTitle = 'RPS Champion';
  } else if (updated.truthCompleted >= 10) {
    updated.currentTitle = 'Truth Master';
  } else if (updated.daresCompleted >= 10) {
    updated.currentTitle = 'Dare King';
  }

  if (isMongo && mongoDb) {
    const col = mongoDb.collection<any>('players');
    await col.updateOne({ id }, { $set: updated });
  } else {
    localCache.players[id] = updated;
    saveLocalDb();
  }

  return updated;
}

export async function addFriend(playerId: string, friendId: string): Promise<boolean> {
  const player = await getPlayerProfile(playerId);
  const friend = await getPlayerProfile(friendId);
  
  if (!player || !friend) return false;
  
  if (!player.friends.includes(friendId)) {
    player.friends.push(friendId);
    await updatePlayerProfile(playerId, { friends: player.friends });
  }
  if (!friend.friends.includes(playerId)) {
    friend.friends.push(playerId);
    await updatePlayerProfile(friendId, { friends: friend.friends });
  }
  
  return true;
}

export async function removeFriend(playerId: string, friendId: string): Promise<boolean> {
  const player = await getPlayerProfile(playerId);
  const friend = await getPlayerProfile(friendId);
  
  if (!player || !friend) return false;
  
  const pFriends = player.friends.filter(f => f !== friendId);
  const fFriends = friend.friends.filter(f => f !== playerId);
  
  await updatePlayerProfile(playerId, { friends: pFriends });
  await updatePlayerProfile(friendId, { friends: fFriends });
  
  return true;
}
