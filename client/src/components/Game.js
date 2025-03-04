import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import io from 'socket.io-client';

const socket = io('http://localhost:4000');

const Game = ({ playerName }) => {
  const gameRef = useRef(null);
  const gameInstance = useRef(null);

  useEffect(() => {
    // Disable right click on the entire document
    const handleContextMenu = (e) => {
      e.preventDefault();
      return false;
    };
    
    document.addEventListener('contextmenu', handleContextMenu);
    
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
            this.TONGUE_SPEED = 1200; // pixels per second
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
            const instructions = this.add.text(20, 20, 'Left Click: Move to nearby lily pad\nRight Click: Extend tongue\nPress H to toggle instructions\nPress L to toggle leaderboard', instructionsStyle);
            instructions.setScrollFactor(0); // Fix to camera
            instructions.setDepth(1000); // Ensure it's always on top

            // Add keyboard event for toggling instructions
            this.input.keyboard.on('keydown-H', () => {
              instructions.setVisible(!instructions.visible);
            });

            // Create leaderboard UI
            const leaderboardStyle = {
              font: 'bold 20px Arial',
              fill: '#ffffff',
              stroke: '#000000',
              strokeThickness: 3,
              align: 'right',
              shadowOffsetX: 2,
              shadowOffsetY: 2,
              shadowColor: '#000000',
              shadowBlur: 4
            };
            
            this.leaderboardTitle = this.add.text(0, 20, '🏆 Top Frogs 🏆', leaderboardStyle);
            this.leaderboardTitle.setScrollFactor(0);
            this.leaderboardTitle.setDepth(1000);
            
            this.leaderboardText = this.add.text(0, 50, '', {
              ...leaderboardStyle,
              font: '18px Arial'
            });
            this.leaderboardText.setScrollFactor(0);
            this.leaderboardText.setDepth(1000);

            // Position leaderboard in top right with padding
            const updateLeaderboardPosition = () => {
              const padding = 20;
              this.leaderboardTitle.setPosition(
                this.cameras.main.width - this.leaderboardTitle.width - padding,
                padding
              );
              this.leaderboardText.setPosition(
                this.cameras.main.width - this.leaderboardText.width - padding,
                this.leaderboardTitle.y + this.leaderboardTitle.height + 5
              );
            };

            // Update leaderboard text
            this.updateLeaderboard = () => {
              if (!this.players) return;
              
              // Convert players Map to array and sort by level
              const sortedPlayers = Array.from(this.players.values())
                .map(player => ({
                  name: player.nameText.text.split(' (')[0],
                  level: player.level
                }))
                .sort((a, b) => b.level - a.level)
                .slice(0, 3);  // Get top 3

              // Format leaderboard text
              const leaderboardContent = sortedPlayers
                .map((player, index) => {
                  const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
                  return `${medal} ${player.name} (Lvl ${player.level})`;
                })
                .join('\n');

              this.leaderboardText.setText(leaderboardContent);
              updateLeaderboardPosition();
            };

            // Toggle leaderboard visibility with L key
            this.input.keyboard.on('keydown-L', () => {
              this.leaderboardTitle.setVisible(!this.leaderboardTitle.visible);
              this.leaderboardText.setVisible(!this.leaderboardText.visible);
            });

            // Handle window resize for leaderboard positioning
            this.scale.on('resize', updateLeaderboardPosition);

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
                    
                    // Get world coordinates of the click
                    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                    
                    // Calculate distance from click to lily pad center
                    const dx = worldPoint.x - sprite.x;
                    const dy = worldPoint.y - sprite.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // Get the lily pad's radius (half of the scaled width)
                    const lilypadRadius = (sprite.width * sprite.scaleX) / 2;
                    
                    // Only trigger if click is within the circular radius
                    if (distance <= lilypadRadius) {
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
                        // Check if any other frog is on this lily pad
                        let isOccupied = false;
                        const occupyRadius = lilypadRadius * 0.8; // Allow some margin
                        
                        this.players.forEach((otherPlayer, id) => {
                          if (id !== socket.id) { // Don't check against self
                            const playerDx = otherPlayer.x - sprite.x;
                            const playerDy = otherPlayer.y - sprite.y;
                            const playerDistance = Math.sqrt(playerDx * playerDx + playerDy * playerDy);
                            
                            if (playerDistance < occupyRadius) {
                              isOccupied = true;
                            }
                          }
                        });

                        if (!isOccupied) {
                          socket.emit('moveToLilyPad', pad.id);
                        } else {
                          // Show a visual feedback that the pad is occupied
                          sprite.setTint(0xff0000);
                          this.time.delayedCall(200, () => sprite.clearTint());
                        }
                      }
                    }
                  });
                  
                  this.lilyPads.set(pad.id, sprite);
                }
              });

              // Handle players
              state.players.forEach(player => {
                if (!this.players.has(player.id)) {
                  const text = this.add.text(player.x, player.y, '🐸', { 
                    font: `${Math.round(32 * player.size)}px Arial`,
                    align: 'center'
                  });
                  text.setOrigin(0.5);
                  text.setDepth(1); // Below flies
                  
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
                  text.maxHealth = player.maxHealth || (50 + (player.level - 1) * 10); // Base 50 HP + 10 per level
                  text.currentHealth = player.health || text.maxHealth;
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

              // Update leaderboard after all players are processed
              this.updateLeaderboard();

              // Handle flies
              state.flies.forEach(fly => {
                if (!this.flies.has(fly.id)) {
                  const text = this.add.text(fly.x, fly.y, '🪰', { 
                    font: '24px Arial',
                    align: 'center'
                  });
                  text.setOrigin(0.5);
                  text.setDepth(2); // Above frogs
                  
                  // Set initial rotation from fly's angle
                  text.rotation = fly.angle + Math.PI/2; // Offset by 90 degrees to face movement direction
                  
                  this.flies.set(fly.id, text);
                }
              });
            });

            socket.on('playerMoved', ({ id, x, y }) => {
              const player = this.players.get(id);
              if (player) {
                // Store current health values and bar width
                const currentHealth = player.currentHealth;
                const maxHealth = player.maxHealth;
                const currentBarWidth = player.hpBar.width;
                
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
                    // Keep the HP bar aligned with its background and maintain width
                    player.hpBar.x = player.hpBarBackground.x - 25; // Half of the total bar width (50)
                    player.hpBar.width = currentBarWidth;
                  },
                  onComplete: () => {
                    // Ensure health values are maintained
                    player.currentHealth = currentHealth;
                    player.maxHealth = maxHealth;
                    this.updateHPBar(player);
                  }
                });
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
                  font: 'bold 24px Arial',
                  fill: '#ff0000',
                  stroke: '#000000',
                  strokeThickness: 3
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
                
                // Add HP text to health bar for clarity
                const hpText = this.add.text(player.x, player.y + 30, `${Math.round(health)}/${maxHealth}`, {
                  font: '12px Arial',
                  fill: '#ffffff',
                  stroke: '#000000',
                  strokeThickness: 2
                });
                hpText.setOrigin(0.5);
                hpText.setDepth(3);
                
                // Fade out HP text
                this.tweens.add({
                  targets: hpText,
                  alpha: 0,
                  duration: 2000,
                  ease: 'Power2',
                  onComplete: () => hpText.destroy()
                });
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

            socket.on('playerDisconnected', (id) => {
              const player = this.players.get(id);
              if (player) {
                if (player.nameText) player.nameText.destroy();
                if (player.hpBar) player.hpBar.destroy();
                if (player.hpBarBackground) player.hpBarBackground.destroy();
                player.destroy();
                this.players.delete(id);
                
                // Update leaderboard after player disconnects
                this.updateLeaderboard();
              }
            });

            socket.on('playerJoined', (player) => {
              if (!this.players.has(player.id)) {
                const text = this.add.text(player.x, player.y, '🐸', { 
                  font: `${Math.round(32 * player.size)}px Arial`,
                  align: 'center'
                });
                text.setOrigin(0.5);
                text.setDepth(1); // Below flies
                
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
                text.maxHealth = player.maxHealth || (50 + (player.level - 1) * 10); // Base 50 HP + 10 per level
                text.currentHealth = player.health || text.maxHealth;
                text.level = player.level || 1;
                
                // Update HP bar width based on health
                this.updateHPBar(text);
                
                this.players.set(player.id, text);

                // Update leaderboard when new player joins
                this.updateLeaderboard();

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
                
                // Update leaderboard after level change
                this.updateLeaderboard();
                
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
              text.setDepth(2); // Above frogs
              
              // Set initial rotation from fly's angle
              text.rotation = fly.angle + Math.PI/2; // Offset by 90 degrees to face movement direction
              
              this.flies.set(fly.id, text);
            });

            socket.on('fliesUpdated', (flies) => {
              flies.forEach(fly => {
                const sprite = this.flies.get(fly.id);
                if (sprite) {
                  // Calculate the shortest rotation path
                  let targetRotation = fly.angle + Math.PI/2;
                  let currentRotation = sprite.rotation;
                  
                  // Normalize angles to [-PI, PI]
                  while (targetRotation > Math.PI) targetRotation -= Math.PI * 2;
                  while (targetRotation < -Math.PI) targetRotation += Math.PI * 2;
                  while (currentRotation > Math.PI) currentRotation -= Math.PI * 2;
                  while (currentRotation < -Math.PI) currentRotation += Math.PI * 2;
                  
                  // Find shortest rotation direction
                  let rotationDiff = targetRotation - currentRotation;
                  if (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
                  if (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;
                  
                  // Smoothly interpolate position and rotation
                  this.tweens.add({
                    targets: sprite,
                    x: fly.x,
                    y: fly.y,
                    rotation: currentRotation + rotationDiff,
                    duration: 1000/30, // Slower updates for smoother movement
                    ease: 'Sine.easeInOut'
                  });
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
              
              // Add 20% to the target distance for a more natural feel
              const extendedDistance = distance * 1.2;
              
              // Calculate tongue end point, limiting by MAX_TONGUE_LENGTH
              const scale = Math.min(extendedDistance, this.MAX_TONGUE_LENGTH) / distance;
              const tongueEndX = this.localPlayer.x + dx * scale;
              const tongueEndY = this.localPlayer.y + dy * scale;

              if (!this.tongue) {
                this.tongue = this.add.graphics();
              }
              
              // Calculate animation duration based on actual tongue length and constant speed
              const tongueLength = Math.min(extendedDistance, this.MAX_TONGUE_LENGTH);
              const singleTripDuration = (tongueLength / this.TONGUE_SPEED) * 1000; // Convert to milliseconds
              
              // Start tongue animation
              this.isExtendingTongue = true;
              this.tongueStartTime = this.time.now;
              this.tongueTarget = { 
                x: tongueEndX, 
                y: tongueEndY,
                worldX: tongueEndX, // Store world coordinates
                worldY: tongueEndY,
                startX: this.localPlayer.x,
                startY: this.localPlayer.y,
                duration: singleTripDuration // Duration for one-way trip (extend or retract)
              };

              // Automatically clear tongue after full animation (extend + retract)
              this.time.delayedCall(singleTripDuration * 2, () => {
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

            // Send player name to server and request spawn position
            const trimmedName = playerName.slice(0, 16); // Limit name to 16 chars
            
            // Check if name is available first
            socket.emit('checkName', trimmedName, (isAvailable) => {
              if (isAvailable) {
                socket.emit('newPlayer', trimmedName);
                // Request game state after successful join
                socket.emit('gameState');
              } else {
                // Show error message if name is taken
                const errorText = this.add.text(
                  this.cameras.main.centerX,
                  this.cameras.main.centerY,
                  'Username already taken!\nPlease refresh and try a different name.',
                  {
                    font: 'bold 32px Arial',
                    fill: '#ff0000',
                    stroke: '#000000',
                    strokeThickness: 6,
                    align: 'center'
                  }
                );
                errorText.setOrigin(0.5);
                errorText.setScrollFactor(0);
                errorText.setDepth(1000);
              }
            });

            // Add timeout for game state
            const stateTimeout = this.time.delayedCall(5000, () => {
              const timeoutText = this.add.text(
                this.cameras.main.centerX,
                this.cameras.main.centerY,
                'Failed to load game state!\nPlease refresh the page.',
                {
                  font: 'bold 32px Arial',
                  fill: '#ff0000',
                  stroke: '#000000',
                  strokeThickness: 6,
                  align: 'center'
                }
              );
              timeoutText.setOrigin(0.5);
              timeoutText.setScrollFactor(0);
              timeoutText.setDepth(1000);
            });

            // Clear timeout when game state is received
            socket.on('gameState', (state) => {
              if (stateTimeout) {
                stateTimeout.remove();
              }
              
              if (!state) {
                return;
              }

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
                    
                    // Get world coordinates of the click
                    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
                    
                    // Calculate distance from click to lily pad center
                    const dx = worldPoint.x - sprite.x;
                    const dy = worldPoint.y - sprite.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // Get the lily pad's radius (half of the scaled width)
                    const lilypadRadius = (sprite.width * sprite.scaleX) / 2;
                    
                    // Only trigger if click is within the circular radius
                    if (distance <= lilypadRadius) {
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
                        // Check if any other frog is on this lily pad
                        let isOccupied = false;
                        const occupyRadius = lilypadRadius * 0.8; // Allow some margin
                        
                        this.players.forEach((otherPlayer, id) => {
                          if (id !== socket.id) { // Don't check against self
                            const playerDx = otherPlayer.x - sprite.x;
                            const playerDy = otherPlayer.y - sprite.y;
                            const playerDistance = Math.sqrt(playerDx * playerDx + playerDy * playerDy);
                            
                            if (playerDistance < occupyRadius) {
                              isOccupied = true;
                            }
                          }
                        });

                        if (!isOccupied) {
                          socket.emit('moveToLilyPad', pad.id);
                        } else {
                          // Show a visual feedback that the pad is occupied
                          sprite.setTint(0xff0000);
                          this.time.delayedCall(200, () => sprite.clearTint());
                        }
                      }
                    }
                  });
                  
                  this.lilyPads.set(pad.id, sprite);
                }
              });

              // Handle players
              state.players.forEach(player => {
                if (!this.players.has(player.id)) {
                  const text = this.add.text(player.x, player.y, '🐸', { 
                    font: `${Math.round(32 * player.size)}px Arial`,
                    align: 'center'
                  });
                  text.setOrigin(0.5);
                  text.setDepth(1); // Below flies
                  
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
                  text.maxHealth = player.maxHealth || (50 + (player.level - 1) * 10); // Base 50 HP + 10 per level
                  text.currentHealth = player.health || text.maxHealth;
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

              // Update leaderboard after all players are processed
              this.updateLeaderboard();

              // Handle flies
              state.flies.forEach(fly => {
                if (!this.flies.has(fly.id)) {
                  const text = this.add.text(fly.x, fly.y, '🪰', { 
                    font: '24px Arial',
                    align: 'center'
                  });
                  text.setOrigin(0.5);
                  text.setDepth(2); // Above frogs
                  
                  // Set initial rotation from fly's angle
                  text.rotation = fly.angle + Math.PI/2; // Offset by 90 degrees to face movement direction
                  
                  this.flies.set(fly.id, text);
                }
              });
            });
          },
          update: function() {
            // Update game state
            if (this.tongue && this.localPlayer && this.isExtendingTongue) {
              const elapsed = this.time.now - this.tongueStartTime;
              const progress = Math.min(elapsed / this.tongueTarget.duration, 2);
              
              // Calculate current tongue position
              let currentX, currentY;
              
              if (progress <= 1) {
                // Extending phase
                const dx = this.tongueTarget.worldX - this.localPlayer.x;
                const dy = this.tongueTarget.worldY - this.localPlayer.y;
                const currentDistance = Math.sqrt(dx * dx + dy * dy);
                const currentScale = Math.min(currentDistance, this.MAX_TONGUE_LENGTH) / currentDistance;
                
                currentX = this.localPlayer.x + dx * progress * currentScale;
                currentY = this.localPlayer.y + dy * progress * currentScale;

                // Check for collisions with flies
                this.flies.forEach((fly, id) => {
                  const distanceToTip = Math.sqrt(
                    Math.pow(fly.x - currentX, 2) + Math.pow(fly.y - currentY, 2)
                  );

                  if (distanceToTip < 20) {
                    socket.emit('catchFly', id);
                  }
                });

                // Check for collisions with players
                this.players.forEach((player, id) => {
                  if (id === socket.id) return; // Skip self

                  const frogSize = Math.round(32 * player.scale);
                  const hitRadius = (frogSize / 2) + 5; // Half the frog size plus small 5px buffer for better feel
                  const distanceToTip = Math.sqrt(
                    Math.pow(player.x - currentX, 2) + Math.pow(player.y - currentY, 2)
                  );

                  if (distanceToTip <= hitRadius) {
                    socket.emit('tongueAttack', id);
                    
                    // Visual feedback at exact hit point
                    const hitEffect = this.add.circle(currentX, currentY, 5, 0xff0000);
                    this.tweens.add({
                      targets: hitEffect,
                      alpha: 0,
                      scale: 2,
                      duration: 200,
                      ease: 'Power2',
                      onComplete: () => hitEffect.destroy()
                    });
                  }
                });
              } else {
                // Retracting phase
                const retractProgress = progress - 1;
                const dx = this.tongueTarget.worldX - this.localPlayer.x;
                const dy = this.tongueTarget.worldY - this.localPlayer.y;
                const currentDistance = Math.sqrt(dx * dx + dy * dy);
                const currentScale = Math.min(currentDistance, this.MAX_TONGUE_LENGTH) / currentDistance;
                
                const extendedX = this.localPlayer.x + dx * currentScale;
                const extendedY = this.localPlayer.y + dy * currentScale;
                
                currentX = extendedX + (this.localPlayer.x - extendedX) * retractProgress;
                currentY = extendedY + (this.localPlayer.y - extendedY) * retractProgress;
              }

              // Draw tongue
              this.tongue.clear();
              this.tongue.lineStyle(4, 0xff0000);
              this.tongue.setDepth(2.5);
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
      // Clean up the context menu handler
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [playerName]);

  return <div id="game-container" ref={gameRef} />;
};

export default Game; 