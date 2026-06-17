import Phaser from 'phaser';
import audio from './AudioEngine';

// Crayon style SVGs inlined and loaded as ObjectURLs
const BASE_SCALE = 0.5;

const ROCK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="300" height="300">
  <!-- Jagged rock shape - rough and uneven -->
  <path d="M 28,70 L 22,50 L 32,30 L 52,22 L 72,24 L 92,34 L 98,52 L 92,75 L 75,92 L 48,94 L 32,85 Z" fill="#9CA2A6" stroke="#4A4640" stroke-width="5" stroke-linejoin="round" />
  <!-- Ridges around the edges to make it feel rough and faceted but leaving face clear -->
  <path d="M 22,50 L 42,48 L 32,30" stroke="#4A4640" stroke-width="4" stroke-linejoin="round" fill="none" />
  <path d="M 72,24 L 78,44 L 92,34" stroke="#4A4640" stroke-width="4" stroke-linejoin="round" fill="none" />
  <path d="M 98,52 L 82,62 L 92,75" stroke="#4A4640" stroke-width="4" stroke-linejoin="round" fill="none" />
  <path d="M 48,94 L 42,76 L 32,85" stroke="#4A4640" stroke-width="4" stroke-linejoin="round" fill="none" />
  <!-- Crayon texture lines -->
  <path d="M26,58 L32,56 M30,42 L36,40 M80,30 L84,36 M88,60 L82,64 M60,86 L56,90" stroke="#7E8488" stroke-width="3" stroke-linecap="round" />
  <!-- Cute face -->
  <circle cx="50" cy="55" r="6" fill="#4A4640" />
  <circle cx="75" cy="55" r="6" fill="#4A4640" />
  <path d="M57,68 C62,72 68,72 73,68" stroke="#4A4640" stroke-width="4" stroke-linecap="round" fill="none" />
  <path d="M44,45 C48,48 52,48 56,45 M69,45 C73,48 77,48 81,45" stroke="#4A4640" stroke-width="3" stroke-linecap="round" fill="none" />
</svg>
`;

const PAPER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="300" height="300">
  <!-- Folded sheet with custom borders -->
  <rect x="25" y="20" width="70" height="80" rx="6" fill="#FFFFFF" stroke="#4A4640" stroke-width="5" />
  <!-- Paper lines -->
  <line x1="35" y1="35" x2="85" y2="35" stroke="#A8D1FF" stroke-width="4" stroke-linecap="round" />
  <line x1="35" y1="50" x2="85" y2="50" stroke="#A8D1FF" stroke-width="4" stroke-linecap="round" />
  <line x1="35" y1="65" x2="85" y2="65" stroke="#A8D1FF" stroke-width="4" stroke-linecap="round" />
  <line x1="35" y1="80" x2="85" y2="80" stroke="#A8D1FF" stroke-width="4" stroke-linecap="round" />
  <!-- Margin line -->
  <line x1="45" y1="20" x2="45" y2="100" stroke="#FFAAA5" stroke-width="3" />
  <!-- Cute face -->
  <circle cx="55" cy="58" r="5" fill="#4A4640" />
  <circle cx="75" cy="58" r="5" fill="#4A4640" />
  <path d="M61,68 Q65,72 69,68" stroke="#4A4640" stroke-width="3" stroke-linecap="round" fill="none" />
</svg>
`;

const SCISSORS_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="300" height="300">
  <!-- Left Blade -->
  <path d="M30,35 L60,60 L85,45 L40,25 Z" fill="#E2E8F0" stroke="#4A4640" stroke-width="4" />
  <!-- Right Blade -->
  <path d="M30,85 L60,60 L85,75 L40,95 Z" fill="#CBD5E1" stroke="#4A4640" stroke-width="4" />
  <!-- Pivot Screw -->
  <circle cx="60" cy="60" r="5" fill="#FFE38A" stroke="#4A4640" stroke-width="3" />
  <!-- Handles -->
  <circle cx="30" cy="30" r="14" fill="none" stroke="#CBB6FF" stroke-width="7" />
  <circle cx="30" cy="30" r="14" fill="none" stroke="#4A4640" stroke-width="3" />
  <circle cx="30" cy="90" r="14" fill="none" stroke="#8FE3D4" stroke-width="7" />
  <circle cx="30" cy="90" r="14" fill="none" stroke="#4A4640" stroke-width="3" />
  <!-- Cute Face on joint -->
  <circle cx="72" cy="52" r="3" fill="#4A4640" />
  <circle cx="72" cy="68" r="3" fill="#4A4640" />
</svg>
`;

const SPARKLE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" width="90" height="90">
  <path d="M15,2 L18,12 L28,15 L18,18 L15,28 L12,18 L2,15 L12,12 Z" fill="#FFE38A" />
</svg>
`;

const PARTICLE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <circle cx="8" cy="8" r="6" fill="#FFAAA5" />
</svg>
`;

function createBlobUrl(svgContent: string): string {
  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  return URL.createObjectURL(blob);
}

export interface PhaserGameConfig {
  parent: string | HTMLElement;
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

export function startPhaserGame(config: PhaserGameConfig): Phaser.Game {
  const urls = {
    rock: createBlobUrl(ROCK_SVG),
    paper: createBlobUrl(PAPER_SVG),
    scissors: createBlobUrl(SCISSORS_SVG),
    sparkle: createBlobUrl(SPARKLE_SVG),
    particle: createBlobUrl(PARTICLE_SVG)
  };

  class RPSArenaScene extends Phaser.Scene {
    private p1Move!: 'rock' | 'paper' | 'scissors';
    private p2Move!: 'rock' | 'paper' | 'scissors';
    private winnerId!: string | 'draw' | null;
    private onCompleteCallback!: () => void;

    private leftHand!: Phaser.GameObjects.Sprite;
    private rightHand!: Phaser.GameObjects.Sprite;
    


    constructor() {
      super('RPSArenaScene');
    }

    init() {
      this.p1Move = config.p1Move;
      this.p2Move = config.p2Move;
      this.winnerId = config.winnerId;
      this.onCompleteCallback = config.onComplete;
    }

    preload() {
      this.load.image('rock', urls.rock);
      this.load.image('paper', urls.paper);
      this.load.image('scissors', urls.scissors);
      this.load.image('sparkle', urls.sparkle);
      this.load.image('particle', urls.particle);
    }

    create() {
      const { width, height } = this.scale;

      // Draw middle dividing net (crayon line)
      const graphics = this.add.graphics();
      graphics.lineStyle(4, 0x4a4640, 0.4);
      graphics.beginPath();
      graphics.moveTo(width / 2, 50);
      graphics.lineTo(width / 2, height - 50);
      graphics.strokePath();

      // Setup Player 1 (Left) details
      this.add.text(80, 40, config.p1Avatar, { fontSize: '42px' }).setOrigin(0.5);
      this.add.text(80, 80, config.p1Name, {
        font: '600 18px Fredoka',
        color: '#4A4640'
      }).setOrigin(0.5);

      // Setup Player 2 (Right) details
      this.add.text(width - 80, 40, config.p2Avatar, { fontSize: '42px' }).setOrigin(0.5);
      this.add.text(width - 80, 80, config.p2Name, {
        font: '600 18px Fredoka',
        color: '#4A4640'
      }).setOrigin(0.5);

      // Create main game hand sprites off-screen
      this.leftHand = this.add.sprite(-100, height / 2 + 10, this.p1Move);
      this.leftHand.setOrigin(0.5);
      this.leftHand.setScale(BASE_SCALE);

      this.rightHand = this.add.sprite(width + 100, height / 2 + 10, this.p2Move);
      this.rightHand.setOrigin(0.5);
      this.rightHand.setScale(BASE_SCALE);
      this.rightHand.setFlipX(true); // Flip right hand

      // Reveal animation timeline
      this.tweens.add({
        targets: this.leftHand,
        x: width * 0.3,
        duration: 800,
        ease: 'Back.easeOut',
        onStart: () => {
          audio.playPaperFold(); // play whoosh/slide
        }
      });

      this.tweens.add({
        targets: this.rightHand,
        x: width * 0.7,
        duration: 800,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.time.delayedCall(400, () => {
            this.runBattleAnimation(width, height);
          });
        }
      });
    }

    runBattleAnimation(width: number, height: number) {
      // Impact camera zoom
      const mainCamera = this.cameras.main;

      if (this.winnerId === 'draw') {
        // RUSH HANDS TO CENTER FOR IMPACT
        this.tweens.add({
          targets: this.leftHand,
          x: width / 2 - 20,
          duration: 250,
          ease: 'Power2.easeIn'
        });

        this.tweens.add({
          targets: this.rightHand,
          x: width / 2 + 20,
          duration: 250,
          ease: 'Power2.easeIn',
          onComplete: () => {
            // IMPACT EFFECTS
            audio.playRockImpact();
            mainCamera.shake(300, 0.03);
            mainCamera.flash(150, 255, 255, 255);

            // Spawn dust particles
            this.add.particles(width / 2, height / 2, 'particle', {
              speed: { min: 80, max: 300 },
              angle: { min: 0, max: 360 },
              scale: { start: 0.6, end: 0.05 },
              lifespan: 1000,
              quantity: 30,
              gravityY: 150
            });

            // Bounce both hands backwards with squash-stretch yoyo
            this.tweens.add({
              targets: this.leftHand,
              x: width * 0.25,
              scaleX: BASE_SCALE * 1.3,
              scaleY: BASE_SCALE * 0.6,
              duration: 200,
              yoyo: true,
              ease: 'Sine.easeInOut'
            });

            this.tweens.add({
              targets: this.rightHand,
              x: width * 0.75,
              scaleX: BASE_SCALE * 1.3,
              scaleY: BASE_SCALE * 0.6,
              duration: 200,
              yoyo: true,
              ease: 'Sine.easeInOut',
              onComplete: () => {
                this.showDrawBanner(width, height);
              }
            });
          }
        });
      } else {
        const p1Wins = this.winnerId === 'p1' || config.winnerId === config.p1Name;
        const winnerHand = p1Wins ? this.leftHand : this.rightHand;
        const loserHand = p1Wins ? this.rightHand : this.leftHand;
        const winningMove = p1Wins ? this.p1Move : this.p2Move;
        const losingMove = p1Wins ? this.p2Move : this.p1Move;

        // Perform attack
        this.tweens.add({
          targets: winnerHand,
          x: width / 2 + (p1Wins ? -20 : 20),
          scaleX: BASE_SCALE * 1.16,
          duration: 250,
          ease: 'Power2.easeIn',
          onComplete: () => {
            this.triggerClashEffect(winningMove, losingMove, winnerHand, loserHand, p1Wins, width, height);
          }
        });
      }
    }

    triggerClashEffect(
      winnerMove: string, 
      loserMove: string, 
      winnerHand: Phaser.GameObjects.Sprite, 
      loserHand: Phaser.GameObjects.Sprite, 
      p1Wins: boolean,
      width: number,
      height: number
    ) {
      const mainCamera = this.cameras.main;

      // CAMERA IMPACT EFFECT
      mainCamera.shake(300, 0.02);
      mainCamera.zoomTo(1.1, 150, 'Quad.easeInOut', true);

      const viewerWon = (this.winnerId === 'p1' && config.viewerRole === 'p1') || 
                        (this.winnerId === 'p2' && config.viewerRole === 'p2');

      // PAPER VS ROCK
      if (winnerMove === 'paper' && loserMove === 'rock') {
        audio.playPaperFold();
        // Paper grows and wraps around rock
        this.tweens.add({
          targets: winnerHand,
          x: loserHand.x,
          scale: BASE_SCALE * 1.5,
          angle: p1Wins ? 45 : -45,
          duration: 350,
          ease: 'Quad.easeOut',
          onComplete: () => {
            // Rock gets covered (shrinks)
            this.tweens.add({
              targets: loserHand,
              scale: 0.01,
              duration: 300,
              onComplete: () => {
                if (viewerWon) {
                  this.spawnSparkles(loserHand.x, loserHand.y);
                  audio.playVictory();
                } else {
                  audio.playDraw();
                }
                this.time.delayedCall(500, () => this.showVictory(width, height));
              }
            });
          }
        });
      }

      // ROCK VS SCISSORS
      else if (winnerMove === 'rock' && loserMove === 'scissors') {
        audio.playRockImpact();
        
        // Spawn debris particles representing broken scissors
        const emitter = this.add.particles(loserHand.x, loserHand.y, 'particle', {
          speed: { min: 100, max: 250 },
          angle: { min: 0, max: 360 },
          scale: { start: 1, end: 0 },
          blendMode: 'NORMAL',
          lifespan: 800,
          gravityY: 300
        });
        
        // Split Scissors: create 2 separate half scissors that fly apart
        const scisHalf1 = this.add.sprite(loserHand.x, loserHand.y, 'scissors').setScale(BASE_SCALE * 0.67).setAngle(45);
        const scisHalf2 = this.add.sprite(loserHand.x, loserHand.y, 'scissors').setScale(BASE_SCALE * 0.67).setAngle(-45).setFlipY(true);
        
        loserHand.setVisible(false); // Hide main scissors
        
        this.tweens.add({
          targets: scisHalf1,
          x: loserHand.x + (p1Wins ? 100 : -100),
          y: loserHand.y - 80,
          angle: 180,
          alpha: 0,
          duration: 600,
        });

        this.tweens.add({
          targets: scisHalf2,
          x: loserHand.x + (p1Wins ? 80 : -80),
          y: loserHand.y + 120,
          angle: -180,
          alpha: 0,
          duration: 600,
          onComplete: () => {
            emitter.stop();
            if (viewerWon) {
              audio.playVictory();
            } else {
              audio.playDraw();
            }
            this.showVictory(width, height);
          }
        });
      }

      // SCISSORS VS PAPER
      else if (winnerMove === 'scissors' && loserMove === 'paper') {
        audio.playScissorsCut();
        
        // Snip motion
        this.tweens.add({
          targets: winnerHand,
          angle: p1Wins ? 30 : -30,
          duration: 100,
          yoyo: true,
          repeat: 1,
          onComplete: () => {
            // Cut Paper: split paper into floating shards
            const paperHalf1 = this.add.sprite(loserHand.x, loserHand.y - 20, 'paper').setScale(BASE_SCALE * 0.67);
            const paperHalf2 = this.add.sprite(loserHand.x, loserHand.y + 20, 'paper').setScale(BASE_SCALE * 0.67);
            
            loserHand.setVisible(false);
            
            // Slice/cut visual
            this.tweens.add({
              targets: paperHalf1,
              x: loserHand.x + (p1Wins ? 60 : -60),
              y: loserHand.y - 60,
              angle: p1Wins ? 35 : -35,
              alpha: 0,
              duration: 700,
            });

            this.tweens.add({
              targets: paperHalf2,
              x: loserHand.x + (p1Wins ? 40 : -40),
              y: loserHand.y + 80,
              angle: p1Wins ? -25 : 25,
              alpha: 0,
              duration: 700,
              onComplete: () => {
                if (viewerWon) {
                  audio.playVictory();
                } else {
                  audio.playDraw();
                }
                this.showVictory(width, height);
              }
            });
          }
        });
      }
    }

    spawnSparkles(x: number, y: number) {
      this.add.particles(x, y, 'sparkle', {
        speed: { min: 80, max: 180 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.4, end: 0.07 },
        lifespan: 1000,
        quantity: 12
      });
    }

    showDrawBanner(width: number, height: number) {
      const banner = this.add.text(width / 2, height / 2, '⚡ CLASH! ⚡', {
        font: '700 76px Fredoka',
        color: '#FF4E4E',
        stroke: '#2D1414',
        strokeThickness: 10
      }).setOrigin(0.5).setScale(0.01);

      this.tweens.add({
        targets: banner,
        scale: 1.2,
        angle: { from: -10, to: 0 },
        duration: 500,
        ease: 'Elastic.easeOut',
        onComplete: () => {
          this.time.delayedCall(1200, () => {
            this.onCompleteCallback();
          });
        }
      });
    }

    showVictory(width: number, height: number) {
      const isP1 = this.winnerId === 'p1' || config.winnerId === config.p1Name;
      const winnerName = isP1 ? config.p1Name : config.p2Name;
      
      // Determine if viewer is the winner
      const viewerWon = (this.winnerId === 'p1' && config.viewerRole === 'p1') || 
                        (this.winnerId === 'p2' && config.viewerRole === 'p2');
      const bannerText = viewerWon ? 'WINNER!' : 'LOSER!';
      const bannerColor = viewerWon ? '#52D681' : '#FF6F59'; // green for winner, red/coral for loser

      if (viewerWon) {
        // Cheering sparkles only for the winner!
        this.spawnSparkles(width / 2, height / 2 - 50);
        audio.playCheer();
      } else {
        // Defeat audio already played during clash completion
      }

      const banner = this.add.text(width / 2, height / 2 - 30, bannerText, {
        font: '700 56px Fredoka',
        color: bannerColor,
        stroke: '#4A4640',
        strokeThickness: 8
      }).setOrigin(0.5).setScale(0.01);

      const nameSub = this.add.text(width / 2, height / 2 + 35, winnerName, {
        font: '600 24px Fredoka',
        color: '#4A4640',
        backgroundColor: '#FFF7E8',
        padding: { left: 15, right: 15, top: 5, bottom: 5 }
      }).setOrigin(0.5).setAlpha(0);

      // Crayon style sketch border around name sub
      nameSub.setStroke('#4A4640', 4);

      this.tweens.add({
        targets: banner,
        scale: 1,
        duration: 400,
        ease: 'Elastic.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: nameSub,
            alpha: 1,
            y: height / 2 + 45,
            duration: 300,
            onComplete: () => {
              this.time.delayedCall(2000, () => {
                this.onCompleteCallback();
              });
            }
          });
        }
      });
    }
  }

  const phaserConfig: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 600,
    height: 400,
    backgroundColor: '#FFF7E8', // Soft cream background matches design
    parent: config.parent,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false
      }
    },
    scene: [RPSArenaScene]
  };

  return new Phaser.Game(phaserConfig);
}
