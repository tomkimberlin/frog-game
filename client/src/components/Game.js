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
            this.MAX_TONGUE_LENGTH = 150;
            this.TONGUE_ANIMATION_DURATION = 150;
            this.MAX_JUMP_DISTANCE = 300; // Maximum distance between lily pads for jumping
            this.tongueAnimationProgress = 0;
            this.isExtendingTongue = false;
            this.worldSize = { width: 2400, height: 1800 };

            // Set up the larger world and physics bounds
            this.physics.world.setBounds(0, 0, this.worldSize.width, this.worldSize.height);
            this.cameras.main.setBounds(0, 0, this.worldSize.width, this.worldSize.height);
            
            // Create pond background that fills the entire world
            const background = this.add.rectangle(0, 0, this.worldSize.width, this.worldSize.height, 0x87CEEB);
            background.setOrigin(0, 0);
            background.setDepth(-2);
            
            const pondArea = this.add.rectangle(10, 10, this.worldSize.width - 20, this.worldSize.height - 20, 0x4CAF50);
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
            const instructions = this.add.text(20, 20, 'Left Click: Move to nearby lily pad\nRight Click: Extend tongue', instructionsStyle);
            instructions.setScrollFactor(0); // Fix to camera
            instructions.setDepth(1000); // Ensure it's always on top

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
                  const sprite = this.add.sprite(player.x, player.y, 'frog');
                  sprite.setScale(player.size * 0.5);
                  sprite.setDepth(2); // Above flies
                  
                  // Enable physics for the player sprite
                  this.physics.world.enable(sprite);
                  sprite.body.setCollideWorldBounds(true);
                  
                  this.players.set(player.id, sprite);
                  
                  if (player.id === socket.id) {
                    this.localPlayer = sprite;
                    // Add name label
                    const style = { font: '16px Arial', fill: '#fff', stroke: '#000000', strokeThickness: 4 };
                    const nameText = this.add.text(player.x, player.y - 30, playerName, style);
                    nameText.setOrigin(0.5);
                    nameText.setDepth(3); // Above everything
                    this.localPlayer.nameText = nameText;
                    
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
                  const sprite = this.add.sprite(fly.x, fly.y, 'fly');
                  sprite.setScale(0.5);
                  sprite.setDepth(1); // Ensure flies are visible above lily pads
                  this.flies.set(fly.id, sprite);
                }
              });
            });

            socket.on('playerMoved', ({ id, x, y }) => {
              const player = this.players.get(id);
              if (player) {
                this.tweens.add({
                  targets: [player, player.nameText], // Move both frog and name text
                  x: x,
                  y: y,
                  duration: 500,
                  ease: 'Power2'
                });
                
                if (player.nameText) {
                  this.tweens.add({
                    targets: player.nameText,
                    y: y - 30, // Keep the name above the frog
                    duration: 500,
                    ease: 'Power2'
                  });
                }
              }
            });

            socket.on('playerDamaged', ({ id, health }) => {
              const player = this.players.get(id);
              if (player) {
                player.setTint(0xff0000);
                this.time.delayedCall(200, () => player.clearTint());
              }
            });

            socket.on('playerDied', (id) => {
              const player = this.players.get(id);
              if (player) {
                player.destroy();
                this.players.delete(id);
              }
            });

            socket.on('flyCaught', ({ flyId, playerId, size }) => {
              const fly = this.flies.get(flyId);
              if (fly) {
                fly.destroy();
                this.flies.delete(flyId);
              }

              const player = this.players.get(playerId);
              if (player) {
                player.setScale(size);
              }
            });

            socket.on('newFly', (fly) => {
              const sprite = this.add.sprite(fly.x, fly.y, 'fly');
              sprite.setScale(0.5);
              sprite.setDepth(1); // Ensure flies are visible above lily pads
              this.flies.set(fly.id, sprite);
            });

            socket.on('fliesUpdated', (flies) => {
              flies.forEach(fly => {
                const sprite = this.flies.get(fly.id);
                if (sprite) {
                  sprite.x = fly.x;
                  sprite.y = fly.y;
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

            // Send player name to server
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