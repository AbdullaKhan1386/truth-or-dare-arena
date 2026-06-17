import React, { useEffect, useRef } from 'react';
import { startPhaserGame } from './PhaserGame';

interface GameArenaProps {
  p1Move: 'rock' | 'paper' | 'scissors';
  p2Move: 'rock' | 'paper' | 'scissors';
  winnerId: string | 'draw' | null;
  p1Name: string;
  p2Name: string;
  p1Avatar: string;
  p2Avatar: string;
  viewerRole: 'p1' | 'p2';
  onComplete: () => void;
}

export const GameArena: React.FC<GameArenaProps> = React.memo(({
  p1Move,
  p2Move,
  winnerId,
  p1Name,
  p2Name,
  p1Avatar,
  p2Avatar,
  viewerRole,
  onComplete
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<any>(null);
  const onCompleteRef = useRef(onComplete);

  // Keep callback reference updated
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (containerRef.current && !gameRef.current) {
      // Small timeout to ensure the container is fully rendered in DOM
      const timer = setTimeout(() => {
        if (!containerRef.current) return;
        
        gameRef.current = startPhaserGame({
          parent: containerRef.current,
          p1Move,
          p2Move,
          winnerId,
          p1Name,
          p2Name,
          p1Avatar,
          p2Avatar,
          viewerRole,
          onComplete: () => {
            onCompleteRef.current();
          }
        });
      }, 50);

      return () => {
        clearTimeout(timer);
        if (gameRef.current) {
          gameRef.current.destroy(true);
          gameRef.current = null;
        }
      };
    }
  }, [p1Move, p2Move, winnerId, p1Name, p2Name, p1Avatar, p2Avatar, viewerRole]);

  return (
    <div className="crayon-card" style={{ padding: '0.5rem', backgroundColor: '#FFF7E8', overflow: 'hidden' }}>
      <div 
        ref={containerRef} 
        id="phaser-game-parent"
        style={{ 
          width: '100%', 
          maxWidth: '600px', 
          aspectRatio: '3/2', 
          margin: '0 auto', 
          borderRadius: '12px',
          overflow: 'hidden' 
        }} 
      />
    </div>
  );
});

export default GameArena;
