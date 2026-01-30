class VoiceRoomApp {
  constructor() {
    this.socket = null;
    
    this.roomCode = null;
    this.userId = null;
    
    this.localStream = null;
    this.peerConnections = new Map();
    this.audioElements = new Map();
    
    this.isMuted = true;
    this.isOpenMic = false;
    this.isPushingToTalk = false;
    this.volume = 1.0;
    this.isDeafened = false;
    
    this.pttKey = 'Space';
    this.pttKeyType = 'keyboard';
    this.isListeningForKey = false;
    
    this.iceServers = {
      iceServers: [
        {
          urls: 'stun:stun.relay.metered.ca:80'
        },
        {
          urls: 'turn:asia-west.relay.metered.ca:80',
          username: 'e5f418bc8a0b531dea77fd1f',
          credential: 'zZ7iu39ydYAWToJq'
        },
        {
          urls: 'turn:asia-west.relay.metered.ca:80?transport=tcp',
          username: 'e5f418bc8a0b531dea77fd1f',
          credential: 'zZ7iu39ydYAWToJq'
        },
        {
          urls: 'turn:asia-west.relay.metered.ca:443',
          username: 'e5f418bc8a0b531dea77fd1f',
          credential: 'zZ7iu39ydYAWToJq'
        },
        {
          urls: 'turns:asia-west.relay.metered.ca:443?transport=tcp',
          username: 'e5f418bc8a0b531dea77fd1f',
          credential: 'zZ7iu39ydYAWToJq'
        }
      ],
      iceCandidatePoolSize: 10
    };
    
    this.handleCreateOrJoin = this.handleCreateOrJoin.bind(this);
    this.handleLeave = this.handleLeave.bind(this);
    this.handleSendMessage = this.handleSendMessage.bind(this);
    this.handlePTTStart = this.handlePTTStart.bind(this);
    this.handlePTTEnd = this.handlePTTEnd.bind(this);
    this.handleOpenMicToggle = this.handleOpenMicToggle.bind(this);
    this.handleMuteToggle = this.handleMuteToggle.bind(this);
    this.handleVolumeChange = this.handleVolumeChange.bind(this);
    this.handleDeafenToggle = this.handleDeafenToggle.bind(this);
    this.handlePTTKeyBind = this.handlePTTKeyBind.bind(this);
    
    this.init();
  }
  
  init() {
    this.elements = {
      landing: document.getElementById('landing'),
      room: document.getElementById('room'),
      roomCodeInput: document.getElementById('room-code-input'),
      actionBtn: document.getElementById('action-btn'),
      errorMessage: document.getElementById('error-message'),
      headerRoomCode: document.getElementById('header-room-code'),
      pttBtn: document.getElementById('ptt-btn'),
      openMicBtn: document.getElementById('open-mic-btn'),
      muteBtn: document.getElementById('mute-btn'),
      deafenBtn: document.getElementById('deafen-btn'),
      volumeSlider: document.getElementById('volume-slider'),
      pttKeyBtn: document.getElementById('ptt-key-btn'),
      chatMessages: document.getElementById('chat-messages'),
      chatInput: document.getElementById('chat-input'),
      sendBtn: document.getElementById('send-btn'),
      leaveBtn: document.getElementById('leave-btn'),
      status: document.getElementById('status'),
      audioContainer: document.getElementById('audio-container')
    };
    
    this.socket = io();
    this.setupSocketHandlers();
    this.setupUIHandlers();
  }
  
  setupSocketHandlers() {
    this.socket.on('user-joined', async ({ socketId, userId }) => {
      console.log(`User joined: ${userId}`);
      this.setStatus(`${userId} joined`);
      await this.createPeerConnection(socketId, true);
    });
    
    this.socket.on('user-left', ({ socketId, userId }) => {
      console.log(`User left: ${userId}`);
      this.setStatus(`${userId} left`);
      this.removePeerConnection(socketId);
    });
    
    this.socket.on('offer', async ({ senderSocketId, offer }) => {
      console.log('Received offer from:', senderSocketId);
      await this.handleOffer(senderSocketId, offer);
    });
    
    this.socket.on('answer', async ({ senderSocketId, answer }) => {
      console.log('Received answer from:', senderSocketId);
      await this.handleAnswer(senderSocketId, answer);
    });
    
    this.socket.on('ice-candidate', async ({ senderSocketId, candidate }) => {
      await this.handleIceCandidate(senderSocketId, candidate);
    });
    
    this.socket.on('receive-message', ({ userId, message }) => {
      this.addChatMessage(userId, message);
    });
    
    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.setStatus('Disconnected');
      this.cleanup();
      this.showLanding();
    });
  }
  
  setupUIHandlers() {
    this.elements.roomCodeInput.addEventListener('input', () => {
      const code = this.elements.roomCodeInput.value.trim();
      this.elements.actionBtn.textContent = code ? 'Join Room' : 'Create Room';
      this.elements.errorMessage.textContent = '';
    });
    
    this.elements.actionBtn.addEventListener('click', this.handleCreateOrJoin);
    
    this.elements.roomCodeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleCreateOrJoin();
    });
    
    this.elements.leaveBtn.addEventListener('click', this.handleLeave);
    
    this.elements.pttBtn.addEventListener('mousedown', this.handlePTTStart);
    this.elements.pttBtn.addEventListener('mouseup', this.handlePTTEnd);
    this.elements.pttBtn.addEventListener('mouseleave', this.handlePTTEnd);
    this.elements.pttBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.handlePTTStart();
    });
    this.elements.pttBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.handlePTTEnd();
    });
    
    document.addEventListener('keydown', (e) => {
      if (this.isListeningForKey) {
        e.preventDefault();
        this.pttKey = e.code;
        this.pttKeyType = 'keyboard';
        this.isListeningForKey = false;
        this.elements.pttKeyBtn.textContent = this.getKeyDisplayName(e.code, 'keyboard');
        this.elements.pttKeyBtn.classList.remove('listening');
        return;
      }
      
      if (this.pttKeyType === 'keyboard' && e.code === this.pttKey && this.roomCode && !this.isOpenMic && 
          document.activeElement !== this.elements.chatInput) {
        e.preventDefault();
        if (!this.isPushingToTalk) this.handlePTTStart();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (this.pttKeyType === 'keyboard' && e.code === this.pttKey && this.roomCode && !this.isOpenMic) {
        e.preventDefault();
        this.handlePTTEnd();
      }
    });
    
    document.addEventListener('mousedown', (e) => {
      if (this.isListeningForKey) {
        e.preventDefault();
        this.pttKey = e.button;
        this.pttKeyType = 'mouse';
        this.isListeningForKey = false;
        this.elements.pttKeyBtn.textContent = this.getKeyDisplayName(e.button, 'mouse');
        this.elements.pttKeyBtn.classList.remove('listening');
        return;
      }
      
      if (this.pttKeyType === 'mouse' && e.button === this.pttKey && this.roomCode && !this.isOpenMic &&
          document.activeElement !== this.elements.chatInput) {
        e.preventDefault();
        if (!this.isPushingToTalk) this.handlePTTStart();
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (this.pttKeyType === 'mouse' && e.button === this.pttKey && this.roomCode && !this.isOpenMic) {
        e.preventDefault();
        this.handlePTTEnd();
      }
    });
    
    document.addEventListener('contextmenu', (e) => {
      if (this.pttKeyType === 'mouse' && this.pttKey === 2 && this.roomCode && !this.isOpenMic) {
        e.preventDefault();
      }
    });
    
    this.elements.pttKeyBtn.addEventListener('click', this.handlePTTKeyBind);
    this.elements.deafenBtn.addEventListener('click', this.handleDeafenToggle);
    this.elements.openMicBtn.addEventListener('click', this.handleOpenMicToggle);
    this.elements.muteBtn.addEventListener('click', this.handleMuteToggle);
    this.elements.volumeSlider.addEventListener('input', this.handleVolumeChange);
    
    this.elements.sendBtn.addEventListener('click', this.handleSendMessage);
    this.elements.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleSendMessage();
    });
  }
  
  async handleCreateOrJoin() {
    const code = this.elements.roomCodeInput.value.trim().toUpperCase();
    
    this.elements.actionBtn.disabled = true;
    this.elements.errorMessage.textContent = '';
    
    try {
      await this.requestMicrophoneAccess();
      
      if (code) {
        await this.joinRoom(code);
      } else {
        await this.createRoom();
      }
    } catch (error) {
      this.elements.errorMessage.textContent = error.message;
      this.elements.actionBtn.disabled = false;
    }
  }
  
  async requestMicrophoneAccess() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: false
      });
      
      this.setMicEnabled(false);
    } catch (error) {
      throw new Error('Microphone access denied');
    }
  }
  
  createRoom() {
    return new Promise((resolve, reject) => {
      this.socket.emit('create-room', (response) => {
        if (response.success) {
          this.roomCode = response.roomCode;
          this.userId = response.userId;
          this.showRoom();
          resolve();
        } else {
          reject(new Error(response.error || 'Failed to create room'));
        }
      });
    });
  }
  
  joinRoom(code) {
    return new Promise((resolve, reject) => {
      this.socket.emit('join-room', code, async (response) => {
        if (response.success) {
          this.roomCode = response.roomCode;
          this.userId = response.userId;
          this.showRoom();
          
          for (const user of response.existingUsers) {
            await this.createPeerConnection(user.socketId, false);
          }
          
          resolve();
        } else {
          let errorMsg = 'Failed to join room';
          if (response.error === 'room-not-found') {
            errorMsg = 'Room not found';
          } else if (response.error === 'room-full') {
            errorMsg = 'Room is full (max 5 users)';
          }
          reject(new Error(errorMsg));
        }
      });
    });
  }
  
  handleLeave() {
    this.socket.emit('leave-room');
    this.cleanup();
    this.showLanding();
  }
  
  showRoom() {
    this.elements.landing.classList.add('hidden');
    this.elements.room.classList.add('active');
    this.elements.headerRoomCode.textContent = this.roomCode;
    this.elements.actionBtn.disabled = false;
    
    this.elements.pttBtn.disabled = false;
    this.elements.openMicBtn.disabled = false;
    this.elements.muteBtn.disabled = false;
    this.elements.deafenBtn.disabled = false;
    
    this.updateAudioButtonStates();
    this.setStatus(`Joined as ${this.userId}`);
  }
  
  showLanding() {
    this.elements.landing.classList.remove('hidden');
    this.elements.room.classList.remove('active');
    this.elements.headerRoomCode.textContent = '';
    this.elements.roomCodeInput.value = '';
    this.elements.actionBtn.textContent = 'Create Room';
    this.elements.chatMessages.innerHTML = '';
    
    this.elements.pttBtn.disabled = true;
    this.elements.openMicBtn.disabled = true;
    this.elements.muteBtn.disabled = true;
    this.elements.deafenBtn.disabled = true;
  }
  
  setStatus(message) {
    this.elements.status.textContent = message;
    setTimeout(() => {
      if (this.elements.status.textContent === message) {
        this.elements.status.textContent = '';
      }
    }, 3000);
  }
  
  async createPeerConnection(socketId, isInitiator) {
    console.log(`Creating peer connection for ${socketId}, initiator: ${isInitiator}`);
    
    const pc = new RTCPeerConnection(this.iceServers);
    this.peerConnections.set(socketId, pc);
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }
    
    pc.ontrack = (event) => {
      console.log('Received remote track from:', socketId);
      this.handleRemoteStream(socketId, event.streams[0]);
    };
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', {
          targetSocketId: socketId,
          candidate: event.candidate
        });
      }
    };
    
    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${socketId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.removePeerConnection(socketId);
      }
    };
    
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state with ${socketId}: ${pc.iceConnectionState}`);
    };
    
    pc.onicegatheringstatechange = () => {
      console.log(`ICE gathering state: ${pc.iceGatheringState}`);
    };
    
    pc.onicecandidateerror = (event) => {
      console.error(`ICE candidate error: ${event.errorCode} - ${event.errorText}`);
    };
    
    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.socket.emit('offer', {
          targetSocketId: socketId,
          offer: pc.localDescription
        });
      } catch (error) {
        console.error('Failed to create offer:', error);
      }
    }
  }
  
  async handleOffer(senderSocketId, offer) {
    let pc = this.peerConnections.get(senderSocketId);
    
    if (!pc) {
      await this.createPeerConnection(senderSocketId, false);
      pc = this.peerConnections.get(senderSocketId);
    }
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      this.socket.emit('answer', {
        targetSocketId: senderSocketId,
        answer: pc.localDescription
      });
    } catch (error) {
      console.error('Failed to handle offer:', error);
    }
  }
  
  async handleAnswer(senderSocketId, answer) {
    const pc = this.peerConnections.get(senderSocketId);
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        console.error('Failed to handle answer:', error);
      }
    }
  }
  
  async handleIceCandidate(senderSocketId, candidate) {
    const pc = this.peerConnections.get(senderSocketId);
    if (pc && candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Failed to add ICE candidate:', error);
      }
    }
  }
  
  handleRemoteStream(socketId, stream) {
    if (socketId === this.socket.id) {
      return;
    }
    
    const existingAudio = this.audioElements.get(socketId);
    if (existingAudio) {
      existingAudio.remove();
    }
    
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.volume = this.isDeafened ? 0 : this.volume;
    audio.muted = this.isDeafened;
    this.elements.audioContainer.appendChild(audio);
    this.audioElements.set(socketId, audio);
  }
  
  removePeerConnection(socketId) {
    const pc = this.peerConnections.get(socketId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(socketId);
    }
    
    const audio = this.audioElements.get(socketId);
    if (audio) {
      audio.remove();
      this.audioElements.delete(socketId);
    }
  }
  
  setMicEnabled(enabled) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
    this.isMuted = !enabled;
    this.updateAudioButtonStates();
  }
  
  handlePTTStart() {
    if (this.isOpenMic || !this.roomCode) return;
    this.isPushingToTalk = true;
    this.setMicEnabled(true);
    this.elements.pttBtn.classList.add('active');
  }
  
  handlePTTEnd() {
    if (this.isOpenMic || !this.roomCode) return;
    this.isPushingToTalk = false;
    this.setMicEnabled(false);
    this.elements.pttBtn.classList.remove('active');
  }
  
  handleOpenMicToggle() {
    this.isOpenMic = !this.isOpenMic;
    
    if (this.isOpenMic) {
      this.setMicEnabled(true);
      this.elements.pttBtn.disabled = true;
    } else {
      this.setMicEnabled(false);
      this.elements.pttBtn.disabled = false;
    }
    
    this.updateAudioButtonStates();
  }
  
  handleMuteToggle() {
    if (this.isOpenMic) {
      this.setMicEnabled(this.isMuted);
    }
    this.updateAudioButtonStates();
  }
  
  handleVolumeChange() {
    this.volume = this.elements.volumeSlider.value / 100;
    this.audioElements.forEach(audio => {
      audio.volume = this.isDeafened ? 0 : this.volume;
    });
  }
  
  handleDeafenToggle() {
    this.isDeafened = !this.isDeafened;
    
    this.audioElements.forEach(audio => {
      audio.muted = this.isDeafened;
      audio.volume = this.isDeafened ? 0 : this.volume;
    });
    
    this.updateAudioButtonStates();
  }
  
  handlePTTKeyBind() {
    this.isListeningForKey = true;
    this.elements.pttKeyBtn.textContent = 'Press key or mouse...';
    this.elements.pttKeyBtn.classList.add('listening');
  }
  
  getKeyDisplayName(code, type) {
    if (type === 'mouse') {
      const mouseMap = {
        0: 'Mouse Left',
        1: 'Mouse Middle',
        2: 'Mouse Right',
        3: 'Mouse 4',
        4: 'Mouse 5'
      };
      return mouseMap[code] || `Mouse ${code}`;
    }
    
    const keyMap = {
      'Space': 'Space',
      'ControlLeft': 'Left Ctrl',
      'ControlRight': 'Right Ctrl',
      'ShiftLeft': 'Left Shift',
      'ShiftRight': 'Right Shift',
      'AltLeft': 'Left Alt',
      'AltRight': 'Right Alt',
      'Tab': 'Tab',
      'CapsLock': 'Caps Lock',
      'Backquote': '`',
      'Escape': 'Escape'
    };
    
    if (keyMap[code]) return keyMap[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  }
  
  updateAudioButtonStates() {
    this.elements.pttBtn.textContent = this.isPushingToTalk ? 'Speaking...' : 'Push to Talk';
    this.elements.pttBtn.disabled = this.isOpenMic || !this.roomCode;
    
    this.elements.openMicBtn.textContent = `Open Mic: ${this.isOpenMic ? 'ON' : 'OFF'}`;
    this.elements.openMicBtn.classList.toggle('active', this.isOpenMic);
    
    this.elements.muteBtn.textContent = this.isMuted ? 'Muted' : 'Unmuted';
    this.elements.muteBtn.classList.toggle('muted', this.isMuted);
    
    this.elements.deafenBtn.textContent = `Deafen: ${this.isDeafened ? 'ON' : 'OFF'}`;
    this.elements.deafenBtn.classList.toggle('deafened', this.isDeafened);
  }
  
  handleSendMessage() {
    const message = this.elements.chatInput.value.trim();
    if (!message || !this.roomCode) return;
    
    this.socket.emit('send-message', message);
    this.elements.chatInput.value = '';
  }
  
  addChatMessage(userId, message) {
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';
    
    const userSpan = document.createElement('span');
    userSpan.className = 'user-id';
    userSpan.textContent = userId + ':';
    
    const textNode = document.createTextNode(message);
    
    messageEl.appendChild(userSpan);
    messageEl.appendChild(textNode);
    
    this.elements.chatMessages.appendChild(messageEl);
    this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
  }
  
  cleanup() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    this.peerConnections.forEach((pc, socketId) => {
      pc.close();
    });
    this.peerConnections.clear();
    
    this.audioElements.forEach(audio => {
      audio.remove();
    });
    this.audioElements.clear();
    
    this.roomCode = null;
    this.userId = null;
    this.isMuted = true;
    this.isOpenMic = false;
    this.isPushingToTalk = false;
    this.isDeafened = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new VoiceRoomApp();
});
