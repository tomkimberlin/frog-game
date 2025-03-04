import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import io from 'socket.io-client';

const socket = io('http://localhost:4000');

const Game = ({ playerName }) => {
  const gameRef = useRef(null);
  const gameInstance = useRef(null);

  useEffect(() => {
    if (!gameInstance.current) {
      const config = {
        type: Phaser.AUTO,
        scale: {
          mode: Phaser.Scale.RESIZE,
          parent: 'game-container',
          width: '100%',
          height: '100%',
          autoCenter: Phaser.Scale.CENTER_BOTH
        },
        physics: {
          default: 'arcade',
          arcade: {
            gravity: { y: 0 },
            debug: false
          }
        },
        scene: {
          preload: function() {
            // Load game assets
            this.load.image('frog', 'assets/frog.svg');
            this.load.image('lilypad', 'assets/lilypad.svg');
            this.load.image('fly', 'assets/fly.svg');
          },
          create: function() {
            // Add constants for game mechanics
            this.MAX_TONGUE_LENGTH = 300;
            this.TONGUE_ANIMATION_DURATION = 150;
            this.MAX_JUMP_DISTANCE = 300;
            this.tongueAnimationProgress = 0;
            this.isExtendingTongue = false;
            this.worldSize = { width: 2400, height: 1800 };

            // Create a circle texture for particles
            const particleTexture = this.add.graphics();
            particleTexture.lineStyle(0);
            particleTexture.fillStyle(0xffffff, 1);
            particleTexture.fillCircle(4, 4, 4);
            particleTexture.generateTexture('particle', 8, 8);
            particleTexture.destroy();

            // Add updateHPBar helper function to the scene
            this.updateHPBar = (player) => {
              if (player.hpBar && player.maxHealth) {
                const healthPercent = player.currentHealth / player.maxHealth;
                const width = 50 * healthPercent;
                player.hpBar.width = width;
                
                // Change color based on health percentage
                if (healthPercent > 0.6) {
                  player.hpBar.setFillStyle(0x00ff00); // Green
                } else if (healthPercent > 0.3) {
                  player.hpBar.setFillStyle(0xffff00); // Yellow
                } else {
                  player.hpBar.setFillStyle(0xff0000); // Red
                }
              }
            };

            // Set up the larger world and physics bounds
            this.physics.world.setBounds(0, 0, this.worldSize.width, this.worldSize.height);
            this.cameras.main.setBounds(0, 0, this.worldSize.width, this.worldSize.height);
            
            // Create pond background that fills the entire world
            const background = this.add.rectangle(0, 0, this.worldSize.width, this.worldSize.height, 0x87CEEB);
            background.setOrigin(0, 0);
            background.setDepth(-2);
            
            const pondArea = this.add.rectangle(10, 10, this.worldSize.width - 20, this.worldSize.height - 20, 0xADD8E6);
            pondArea.setOrigin(0, 0);
            pondArea.setDepth(-1);

            // Add instructions text with better visibility
            const instructionsStyle = {
              font: 'bold 20px Arial',
              fill: '#ffffff',
              stroke: '#000000',
              strokeThickness: 3,
              shadowOffsetX: 2,
              shadowOffsetY: 2,
              shadowColor: '#000000',
              shadowBlur: 4
            };
            const instructions = this.add.text(20, 20, 'Left Click: Move to nearby lily pad\nRight Click: Extend tongue\nPress H to toggle instructions', instructionsStyle);
            instructions.setScrollFactor(0); // Fix to camera
            instructions.setDepth(1000); // Ensure it's always on top

            // Add keyboard event for toggling instructions
            this.input.keyboard.on('keydown-H', () => {
              instructions.setVisible(!instructions.visible);
            });

            // Initialize game object collections
            this.players = new Map();
            this.flies = new Map();
            this.lilyPads = new Map();
            this.tongue = null;
            this.localPlayer = null;
            this.tongueStartTime = 0;

            // Handle socket events
            socket.on('gameState', (state) => {
              // Update world size if provided
              if (state.worldSize) {
                this.worldSize = state.worldSize;
                this.physics.world.setBounds(0, 0, state.worldSize.width, state.worldSize.height);
                this.cameras.main.setBounds(0, 0, state.worldSize.width, state.worldSize.height);
                
                // Update background size
                background.width = state.worldSize.width;
                background.height = state.worldSize.height;
                pondArea.width = state.worldSize.width - 20;
                pondArea.height = state.worldSize.height - 20;
              }

              // Create lily pads
              state.lilyPads.forEach(pad => {
                if (!this.lilyPads.has(pad.id)) {
                  const sprite = this.add.sprite(pad.x, pad.y, 'lilypad');
                  sprite.setScale(0.5);
                  sprite.setDepth(0); // Base layer above background
                  sprite.setInteractive(); // Make lily pads clickable
                  sprite.padId = pad.id; // Store the pad ID for reference
                  
                  // Add click handler for this lily pad
                  sprite.on('pointerdown', (pointer) => {
                    if (!this.localPlayer) return;
                    
                    // Only respond to left clicks
                    if (pointer.button !== 0) return;
                    
                    // Check if any part of the lily pad is visible in the camera view
                    const camera = this.cameras.main;
                    const padBounds = sprite.getBounds();
                    const cameraView = camera.worldView;
                    
                    // Check if the pad's bounds intersect with the camera view
                    const isVisible = !(padBounds.right < cameraView.x || 
                                     padBounds.left > cameraView.right ||
                                     padBounds.bottom < cameraView.y || 
                                     padBounds.top > cameraView.bottom);
                    
                    if (isVisible) {
                      socket.emit('moveToLilyPad', pad.id);
                    }
                  });
                  
                  this.lilyPads.set(pad.id, sprite);
                }
              });

              // Handle players
              state.players.forEach(player => {
                if (!this.players.has(player.id)) {
                  const text = this.add.text(player.x, player.y, '🐸', { 
                    font: '32px Arial',
                    align: 'center'
                  });
                  text.setOrigin(0.5);
                  text.setScale(player.size * 1.5);
                  text.setDepth(2); // Above flies
                  
                  // Add name label for all players
                  const style = { font: '16px Arial', fill: '#fff', stroke: '#000000', strokeThickness: 4 };
                  const nameText = this.add.text(player.x, player.y - 30, `${player.name} (Lvl ${player.level || 1})`, style);
                  nameText.setOrigin(0.5);
                  nameText.setDepth(3); // Above everything
                  text.nameText = nameText;

                  // Add HP bar
                  const hpBarWidth = 50;
                  const hpBarHeight = 6;
                  const hpBarBackground = this.add.rectangle(player.x, player.y + 20, hpBarWidth, hpBarHeight, 0x000000);
                  const hpBar = this.add.rectangle(player.x - hpBarWidth/2, player.y + 20, hpBarWidth, hpBarHeight, 0x00ff00);
                  hpBarBackground.setOrigin(0.5);
                  hpBar.setOrigin(0, 0.5);
                  hpBarBackground.setDepth(2.8);
                  hpBar.setDepth(2.9);
                  
                  // Store HP bar references
                  text.hpBarBackground = hpBarBackground;
                  text.hpBar = hpBar;
                  text.maxHealth = player.maxHealth || 100;
                  text.currentHealth = player.health || 100;
                  text.level = player.level || 1;
                  
                  // Update HP bar width based on health
                  this.updateHPBar(text);
                  
                  this.players.set(player.id, text);
                  
                  if (player.id === socket.id) {
                    this.localPlayer = text;
                    // Set up camera follow with lerp (smooth follow)
                    this.cameras.main.setZoom(1); // Ensure zoom is reset
                    
                    // Center camera on spawn point immediately
                    this.cameras.main.centerOn(player.x, player.y);
                    
                    // Start following with smooth transitions after centering
                    this.cameras.main.startFollow(this.localPlayer, true, 0.1, 0.1);
                  }
                }
              });

              // Handle flies
              state.flies.forEach(fly => {
                if (!this.flies.has(fly.id)) {
                  const text = this.add.text(fly.x, fly.y, '🪰', { 
                    font: '24px Arial',
                    align: 'center'
                  });
                  text.setOrigin(0.5);
                  text.setDepth(1); // Ensure flies are visible above lily pads
                  
                  // Calculate initial rotation
                  const dx = fly.targetX - fly.x;
                  const dy = fly.targetY - fly.y;
                  const angle = Math.atan2(dy, dx) + Math.PI/2; // Offset by 90 degrees
                  text.rotation = angle;
                  
                  this.flies.set(fly.id, text);
                }
              });
            });

            socket.on('playerMoved', ({ id, x, y }) => {
              const player = this.players.get(id);
              if (player) {
                // Move the player sprite
                this.tweens.add({
                  targets: player,
                  x: x,
                  y: y,
                  duration: 500,
                  ease: 'Power2'
                });

                // Move the name text with offset
                this.tweens.add({
                  targets: player.nameText,
                  x: x,
                  y: y - 30,
                  duration: 500,
                  ease: 'Power2'
                });

                // Move HP bar and background with offset
                this.tweens.add({
                  targets: [player.hpBarBackground, player.hpBar],
                  x: x,
                  y: y + 20,
                  duration: 500,
                  ease: 'Power2',
                  onUpdate: () => {
                    // Keep the HP bar aligned with its background
                    player.hpBar.x = player.hpBarBackground.x - player.hpBar.width/2;
                  }
                });
              }
            });

            // Handle player being pushed into water
            socket.on('playerPushed', ({ id, pushedBy, fromX, fromY }) => {
              const player = this.players.get(id);
              if (player) {
                // Add splash effect
                const splashEmitter = this.add.particles(fromX, fromY, {
                  speed: { min: 50, max: 100 },
                  scale: { start: 1, end: 0 },
                  alpha: { start: 1, end: 0 },
                  lifespan: 800,
                  quantity: 20,
                  tint: 0x87CEEB
                });
                
                // Clean up particles after animation
                this.time.delayedCall(1000, () => {
                  splashEmitter.destroy();
                });

                // Make the frog bob in the water
                this.tweens.add({
                  targets: [player, player.nameText],
                  y: '+=5',
                  duration: 500,
                  yoyo: true,
                  repeat: 1,
                  ease: 'Sine.inOut'
                });

                // Visual feedback
                player.setAlpha(0.7); // Make the frog look like it's in water
                this.time.delayedCall(1000, () => {
                  player.setAlpha(1);
                });
              }
            });

            // Handle when player can move again
            socket.on('playerCanMove', (id) => {
              const player = this.players.get(id);
              if (player) {
                player.setAlpha(1);
              }
            });

            socket.on('playerDamaged', ({ id, health, maxHealth, damage }) => {
              const player = this.players.get(id);
              if (player) {
                // Flash red
                player.setTint(0xff0000);
                this.time.delayedCall(200, () => player.clearTint());
                
                // Show damage number
                const damageText = this.add.text(player.x, player.y - 40, `-${damage}`, {
                  font: 'bold 20px Arial',
                  fill: '#ff0000'
                });
                damageText.setOrigin(0.5);
                
                // Animate damage number floating up and fading
                this.tweens.add({
                  targets: damageText,
                  y: player.y - 80,
                  alpha: 0,
                  duration: 1000,
                  ease: 'Power2',
                  onComplete: () => damageText.destroy()
                });
                
                // Update health
                player.currentHealth = health;
                player.maxHealth = maxHealth;
                this.updateHPBar(player);
              }
            });

            socket.on('playerDied', (id) => {
              const player = this.players.get(id);
              if (player) {
                // Clean up all player elements
                if (player.nameText) player.nameText.destroy();
                if (player.hpBar) player.hpBar.destroy();
                if (player.hpBarBackground) player.hpBarBackground.destroy();
                player.destroy();
                this.players.delete(id);

                // If this is the local player, show respawn UI
                if (id === socket.id) {
                  // Stop camera follow
                  this.cameras.main.stopFollow();
                  this.localPlayer = null;

                  const respawnText = this.add.text(
                    this.cameras.main.centerX,
                    this.cameras.main.centerY,
                    'You died!\nClick anywhere to respawn',
                    {
                      font: 'bold 32px Arial',
                      fill: '#ffffff',
                      stroke: '#000000',
                      strokeThickness: 6,
                      align: 'center'
                    }
                  );
                  respawnText.setOrigin(0.5);
                  respawnText.setScrollFactor(0);
                  respawnText.setDepth(1000);

                  // Create an invisible button that covers the entire game area
                  const respawnButton = this.add.rectangle(
                    this.cameras.main.centerX,
                    this.cameras.main.centerY,
                    this.cameras.main.width,
                    this.cameras.main.height,
                    0xffffff,
                    0
                  );
                  respawnButton.setScrollFactor(0);
                  respawnButton.setInteractive();
                  respawnButton.setDepth(999);

                  // Add click handler for respawn
                  const respawnHandler = () => {
                    respawnText.destroy();
                    respawnButton.destroy();
                    socket.emit('respawn');
                  };
                  
                  respawnButton.on('pointerdown', respawnHandler);
                }
              }
            });

            // Handle player disconnection cleanup
            socket.on('playerDisconnected', (id) => {
              const player = this.players.get(id);
              if (player) {
                if (player.nameText) player.nameText.destroy();
                if (player.hpBar) player.hpBar.destroy();
                if (player.hpBarBackground) player.hpBarBackground.destroy();
                player.destroy();
                this.players.delete(id);
              }
            });

            socket.on('playerJoined', (player) => {
              if (!this.players.has(player.id)) {
                const text = this.add.text(player.x, player.y, '🐸', { 
                  font: '32px Arial',
                  align: 'center'
                });
                text.setOrigin(0.5);
                text.setScale(player.size * 1.5);
                text.setDepth(2); // Above flies
                
                // Add name and level label for the new player
                const style = { font: '16px Arial', fill: '#fff', stroke: '#000000', strokeThickness: 4 };
                const nameText = this.add.text(player.x, player.y - 30, `${player.name} (Lvl ${player.level || 1})`, style);
                nameText.setOrigin(0.5);
                nameText.setDepth(3); // Above everything
                text.nameText = nameText;

                // Add HP bar
                const hpBarWidth = 50;
                const hpBarHeight = 6;
                const hpBarBackground = this.add.rectangle(player.x, player.y + 20, hpBarWidth, hpBarHeight, 0x000000);
                const hpBar = this.add.rectangle(player.x - hpBarWidth/2, player.y + 20, hpBarWidth, hpBarHeight, 0x00ff00);
                hpBarBackground.setOrigin(0.5);
                hpBar.setOrigin(0, 0.5);
                hpBarBackground.setDepth(2.8);
                hpBar.setDepth(2.9);
                
                // Store HP bar references
                text.hpBarBackground = hpBarBackground;
                text.hpBar = hpBar;
                text.maxHealth = player.maxHealth || 100;
                text.currentHealth = player.health || 100;
                text.level = player.level || 1;
                
                // Update HP bar width based on health
                this.updateHPBar(text);
                
                this.players.set(player.id, text);

                // If this is the local player, set up camera follow
                if (player.id === socket.id) {
                    this.localPlayer = text;
                    
                    // Center camera on spawn point immediately
                    this.cameras.main.centerOn(player.x, player.y);
                    
                    // Start following with smooth transitions
                    this.cameras.main.startFollow(text, true, 0.1, 0.1);
                }
              }
            });

            socket.on('flyCaught', ({ flyId, playerId, size, health, maxHealth, level, xp, didLevelUp }) => {
              const fly = this.flies.get(flyId);
              if (fly) {
                fly.destroy();
                this.flies.delete(flyId);
              }

              const player = this.players.get(playerId);
              if (player) {
                const oldHealth = player.currentHealth;
                player.setScale(size * 1.5);
                player.currentHealth = health;
                player.maxHealth = maxHealth;
                player.level = level;
                this.updateHPBar(player);
                
                // Update name text to include level
                player.nameText.setText(`${player.nameText.text.split(' (')[0]} (Lvl ${level})`);
                
                if (didLevelUp) {
                  // Show level up text with special effects
                  const levelUpText = this.add.text(player.x, player.y - 60, 'LEVEL UP!', {
                    font: 'bold 24px Arial',
                    fill: '#ffff00',
                    stroke: '#000000',
                    strokeThickness: 6
                  });
                  levelUpText.setOrigin(0.5);
                  levelUpText.setDepth(3);
                  
                  // Animate level up text and clean up
                  this.tweens.add({
                    targets: levelUpText,
                    y: player.y - 100,
                    alpha: 0,
                    duration: 2000,
                    ease: 'Power2',
                    onComplete: () => levelUpText.destroy()
                  });
                } else if (health > oldHealth) {
                  // Show healing number if healed
                  const healText = this.add.text(player.x, player.y - 40, `+${Math.round(health - oldHealth)}`, {
                    font: 'bold 20px Arial',
                    fill: '#00ff00'
                  });
                  healText.setOrigin(0.5);
                  
                  // Animate heal number floating up and fading
                  this.tweens.add({
                    targets: healText,
                    y: player.y - 80,
                    alpha: 0,
                    duration: 1000,
                    ease: 'Power2',
                    onComplete: () => healText.destroy()
                  });
                }
              }
            });

            socket.on('newFly', (fly) => {
              const text = this.add.text(fly.x, fly.y, '🪰', { 
                font: '24px Arial',
                align: 'center'
              });
              text.setOrigin(0.5);
              text.setDepth(1); // Ensure flies are visible above lily pads
              
              // Calculate initial rotation
              const dx = fly.targetX - fly.x;
              const dy = fly.targetY - fly.y;
              const angle = Math.atan2(dy, dx) + Math.PI/2; // Offset by 90 degrees
              text.rotation = angle;
              
              this.flies.set(fly.id, text);
            });

            socket.on('fliesUpdated', (flies) => {
              flies.forEach(fly => {
                const sprite = this.flies.get(fly.id);
                if (sprite) {
                  // Calculate angle between current position and target
                  const dx = fly.targetX - fly.x;
                  const dy = fly.targetY - fly.y;
                  const angle = Math.atan2(dy, dx) + Math.PI/2; // Offset by 90 degrees
                  
                  sprite.x = fly.x;
                  sprite.y = fly.y;
                  sprite.rotation = angle;
                }
              });
            });

            // Bind extendTongue to the scene context
            this.extendTongue = (x, y) => {
              if (!this.localPlayer || this.isExtendingTongue) return;

              // Calculate direction and distance to target
              const dx = x - this.localPlayer.x;
              const dy = y - this.localPlayer.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              
              // Calculate tongue end point, limiting by MAX_TONGUE_LENGTH
              const scale = Math.min(distance, this.MAX_TONGUE_LENGTH) / distance;
              const tongueEndX = this.localPlayer.x + dx * scale;
              const tongueEndY = this.localPlayer.y + dy * scale;

              if (!this.tongue) {
                this.tongue = this.add.graphics();
              }
              
              // Start tongue animation
              this.isExtendingTongue = true;
              this.tongueStartTime = this.time.now;
              this.tongueTarget = { 
                x: tongueEndX, 
                y: tongueEndY,
                startX: this.localPlayer.x,
                startY: this.localPlayer.y
              };

              // Check for collisions with flies or other players
              this.flies.forEach((fly, id) => {
                // Calculate distance from fly to tongue line segment
                const A = { x: this.localPlayer.x, y: this.localPlayer.y };
                const B = { x: tongueEndX, y: tongueEndY };
                const P = { x: fly.x, y: fly.y };
                
                // Calculate distance from point P to line segment AB
                const AB = { x: B.x - A.x, y: B.y - A.y };
                const AP = { x: P.x - A.x, y: P.y - A.y };
                const ab2 = AB.x * AB.x + AB.y * AB.y;
                const ap_ab = AP.x * AB.x + AP.y * AB.y;
                let t = ap_ab / ab2;
                
                // Clamp t to line segment bounds
                t = Math.max(0, Math.min(1, t));
                
                // Calculate closest point on line segment
                const closest = {
                  x: A.x + AB.x * t,
                  y: A.y + AB.y * t
                };
                
                // Calculate distance from fly to closest point
                const distanceToTongue = Math.sqrt(
                  Math.pow(P.x - closest.x, 2) + Math.pow(P.y - closest.y, 2)
                );

                // Smaller hit radius for more precise detection
                if (distanceToTongue < 15) {  // Reduced from implied larger radius
                  socket.emit('catchFly', id);
                }
              });

              this.players.forEach((player, id) => {
                if (id !== socket.id) {
                  // Use the same precise line segment distance check for players
                  const A = { x: this.localPlayer.x, y: this.localPlayer.y };
                  const B = { x: tongueEndX, y: tongueEndY };
                  const P = { x: player.x, y: player.y };
                  
                  const AB = { x: B.x - A.x, y: B.y - A.y };
                  const AP = { x: P.x - A.x, y: P.y - A.y };
                  const ab2 = AB.x * AB.x + AB.y * AB.y;
                  const ap_ab = AP.x * AB.x + AP.y * AB.y;
                  let t = ap_ab / ab2;
                  
                  t = Math.max(0, Math.min(1, t));
                  
                  const closest = {
                    x: A.x + AB.x * t,
                    y: A.y + AB.y * t
                  };
                  
                  const distanceToTongue = Math.sqrt(
                    Math.pow(P.x - closest.x, 2) + Math.pow(P.y - closest.y, 2)
                  );

                  if (distanceToTongue < 20) {  // Slightly larger hit radius for players
                    socket.emit('tongueAttack', id);
                  }
                }
              });

              // Automatically clear tongue after animation
              this.time.delayedCall(this.TONGUE_ANIMATION_DURATION * 2, () => {
                this.isExtendingTongue = false;
                this.tongueAnimationProgress = 0;
                if (this.tongue) {
                  this.tongue.clear();
                }
              });
            };

            // Input handling
            this.input.on('pointerdown', (pointer) => {
              // Convert pointer position to world coordinates
              const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
              
              if (pointer.button === 2) { // Right click
                this.extendTongue(worldPoint.x, worldPoint.y);
              }
            });

            // Add fullscreen toggle
            this.input.keyboard.on('keydown-F', () => {
              if (this.scale.isFullscreen) {
                this.scale.stopFullscreen();
              } else {
                this.scale.startFullscreen();
              }
            });

            // Prevent context menu on right click (both ways to be thorough)
            this.input.on('contextmenu', function (e) {
              e.preventDefault();
              return false;
            });
            
            this.game.canvas.addEventListener('contextmenu', function (e) {
              e.preventDefault();
              return false;
            });

            // Send player name to server and request spawn position
            socket.emit('newPlayer', playerName);
          },
          update: function() {
            // Update game state
            if (this.tongue && this.localPlayer && this.isExtendingTongue) {
              const elapsed = this.time.now - this.tongueStartTime;
              const progress = Math.min(elapsed / this.TONGUE_ANIMATION_DURATION, 2);
              
              // Calculate current tongue position
              let currentX, currentY;
              
              if (progress <= 1) {
                // Extending phase
                currentX = this.tongueTarget.startX + (this.tongueTarget.x - this.tongueTarget.startX) * progress;
                currentY = this.tongueTarget.startY + (this.tongueTarget.y - this.tongueTarget.startY) * progress;
              } else {
                // Retracting phase
                const retractProgress = progress - 1;
                currentX = this.tongueTarget.x + (this.tongueTarget.startX - this.tongueTarget.x) * retractProgress;
                currentY = this.tongueTarget.y + (this.tongueTarget.startY - this.tongueTarget.y) * retractProgress;
              }

              // Draw tongue
              this.tongue.clear();
              this.tongue.lineStyle(4, 0xff0000);
              this.tongue.setDepth(2.5); // Between frogs and name labels
              this.tongue.beginPath();
              this.tongue.moveTo(this.localPlayer.x, this.localPlayer.y);
              this.tongue.lineTo(currentX, currentY);
              this.tongue.strokePath();
            }
          }
        }
      };

      gameInstance.current = new Phaser.Game(config);
    }

    return () => {
      if (gameInstance.current) {
        gameInstance.current.destroy(true);
        gameInstance.current = null;
      }
    };
  }, [playerName]);

  return <div id="game-container" ref={gameRef} />;
};

export default Game; 