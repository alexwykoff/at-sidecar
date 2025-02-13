class BlueskyChat {
    constructor() {
        this.peers = new Map();
        this.channelName = this.getChannelFromUrl();
        this.setupUI();
        this.initializePeerConnections();
        this.isInitiator = false; // Will be set based on channel presence
        console.log('Starting chat in channel:', this.channelName);
        
        // Clean up when the page unloads
        window.addEventListener('unload', () => this.destroy());
    }

    getChannelFromUrl() {
        const path = window.location.pathname;
        console.log('Current path:', path);
        
        // Handle homepage
        if (path === '/' || path === '') {
            return 'home';
        }
        
        const parts = path.split('/');
        console.log('URL parts:', parts);
        
        // Handle different URL patterns
        if (parts.includes('hashtag')) {
            return parts[parts.indexOf('hashtag') + 1];
        }
        return parts[parts.length - 1];
    }

    setupUI() {
        console.log('Setting up UI...');
        const checkForContainer = setInterval(() => {
            console.log('Checking for container...');
            
            // Find the main element first as a reference point
            const mainElement = document.querySelector('main');
            if (!mainElement) {
                console.log('Main element not found yet');
                return;
            }

            // Get the parent of main
            const parent = mainElement.parentElement;
            if (!parent) {
                console.log('Parent of main not found');
                return;
            }

            // Find the div that's a sibling of main and nav
            const targetDiv = Array.from(parent.children).find(child => {
                return child.tagName === 'DIV' && 
                       child !== mainElement && 
                       parent.querySelector('nav');
            });

            if (targetDiv) {
                console.log('Found target div:', targetDiv);
                clearInterval(checkForContainer);
                this.createChatUI(targetDiv);
            } else {
                console.log('Target div not found. Parent children:', 
                    Array.from(parent.children).map(child => child.tagName)
                );
            }
        }, 2000);
    }

    createChatUI(parentDiv) {
        console.log('Creating chat UI in parent:', parentDiv);
        
        // Create chat container
        const chatContainer = document.createElement('div');
        chatContainer.className = 'bsky-chat-container';
        console.log('Created chat container');
        
        // Channel info
        const channelInfo = document.createElement('div');
        channelInfo.className = 'channel-info';
        channelInfo.textContent = `Channel: ${this.channelName}`;
        
        // Chat history
        const chatHistory = document.createElement('div');
        chatHistory.className = 'chat-history';
        
        // Input container
        const inputContainer = document.createElement('div');
        inputContainer.className = 'chat-input-container';
        
        const textarea = document.createElement('textarea');
        textarea.className = 'chat-input';
        textarea.placeholder = 'Type a message...';
        
        const sendButton = document.createElement('button');
        sendButton.className = 'chat-send-button';
        sendButton.textContent = 'Send';
        
        // Add minimize/maximize button
        const toggleButton = document.createElement('button');
        toggleButton.className = 'chat-toggle-button';
        toggleButton.textContent = '−';
        
        // Assembly
        inputContainer.appendChild(textarea);
        inputContainer.appendChild(sendButton);
        
        chatContainer.appendChild(toggleButton);
        chatContainer.appendChild(channelInfo);
        chatContainer.appendChild(chatHistory);
        chatContainer.appendChild(inputContainer);
        
        // Insert at the beginning of parentDiv
        parentDiv.insertBefore(chatContainer, parentDiv.firstChild);
        console.log('Inserted chat container into parent');
        
        // Store references
        this.chatHistory = chatHistory;
        this.chatInput = textarea;
        
        // Event listeners
        sendButton.addEventListener('click', () => this.sendMessage());
        textarea.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        toggleButton.addEventListener('click', () => this.toggleChat(chatContainer, toggleButton));

        // Add initial system message
        this.addChatMessage('Chat initialized. Waiting for peers...', 'system');
        
        console.log('Chat UI created');
    }

    toggleChat(container, button) {
        const isMinimized = container.classList.toggle('minimized');
        button.textContent = isMinimized ? '+' : '−';
    }

    initializePeerConnections() {
        this.bc = new BroadcastChannel(`bsky-chat-${this.channelName}`);
        this.lastSignalTime = 0;
        this.signalQueue = [];
        
        // Send a presence check every 5 seconds
        this.presenceInterval = setInterval(() => {
            this.bc.postMessage({ type: 'presence-check' });
        }, 5000);
        
        // Initial presence check
        this.bc.postMessage({ type: 'presence-check' });
        
        this.bc.onmessage = (event) => {
            // Throttle message processing
            const now = Date.now();
            if (now - this.lastSignalTime < 1000) { // Minimum 1 second between signals
                this.signalQueue.push(event);
                return;
            }
            
            this.lastSignalTime = now;
            this.handleBroadcastMessage(event);
        };

        // Process queued messages every second
        setInterval(() => {
            if (this.signalQueue.length > 0) {
                const event = this.signalQueue.shift();
                this.handleBroadcastMessage(event);
            }
        }, 1000);
    }

    handleBroadcastMessage(event) {
        if (event.data.type === 'presence-check') {
            if (!this.isInitiator && !this.hasActivePeer()) {
                console.log('Other peer found, joining as non-initiator');
                this.createPeer(false);
            }
            this.bc.postMessage({ type: 'presence-response' });
        } else if (event.data.type === 'presence-response') {
            if (!this.hasActivePeer()) {
                console.log('Becoming initiator');
                this.isInitiator = true;
                this.createPeer(true);
            }
        } else if (event.data.type === 'signal') {
            this.handleSignal(event.data.data);
        }
    }

    hasActivePeer() {
        return Array.from(this.peers.values()).some(isConnected => isConnected);
    }

    createPeer(initiator) {
        // Prevent creating multiple connections
        if (this.hasActivePeer()) {
            return null;
        }

        try {
            console.log('Creating peer connection as', initiator ? 'initiator' : 'receiver');
            const peer = new SimplePeer({
                initiator: initiator,
                trickle: false,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                }
            });

            peer.on('error', err => {
                console.error('Peer error:', err);
                this.addChatMessage('Connection error. Retrying...', 'system');
                // Remove the peer and try to reconnect
                if (this.peers.has(peer)) {
                    this.peers.delete(peer);
                }
                setTimeout(() => this.createPeer(this.isInitiator), 2000);
            });

            peer.on('signal', data => {
                console.log('Generated signal data:', data.type);
                const bc = new BroadcastChannel(`bsky-chat-${this.channelName}`);
                bc.postMessage({ type: 'signal', data });
            });

            peer.on('connect', () => {
                console.log('Peer connected!');
                this.addChatMessage('Connected to peer!', 'system');
                this.peers.set(peer, true);
            });

            peer.on('data', data => {
                try {
                    const message = JSON.parse(data);
                    this.addChatMessage(message.text, 'peer');
                } catch (e) {
                    console.error('Error parsing message:', e);
                }
            });

            peer.on('close', () => {
                console.log('Peer connection closed');
                this.peers.delete(peer);
                this.addChatMessage('Peer disconnected. Attempting to reconnect...', 'system');
                setTimeout(() => this.createPeer(this.isInitiator), 2000);
            });

            return peer;
        } catch (e) {
            console.error('Error creating peer:', e);
            return null;
        }
    }

    handleSignal(signalData) {
        try {
            console.log('Received signal:', signalData.type);
            // Find an existing peer or create a new one
            let peer = Array.from(this.peers.keys())[0];
            if (!peer) {
                peer = this.createPeer(false);
                if (!peer) return;
            }
            peer.signal(signalData);
        } catch (e) {
            console.error('Error handling signal:', e);
        }
    }

    sendMessage() {
        const text = this.chatInput.value.trim();
        if (!text) return;

        this.addChatMessage(text, 'self');
        
        const message = JSON.stringify({ text });
        
        // Send to all connected peers
        this.peers.forEach((isConnected, peer) => {
            if (isConnected) {
                try {
                    peer.send(message);
                } catch (e) {
                    console.error('Error sending message:', e);
                }
            }
        });

        this.chatInput.value = '';
    }

    addChatMessage(text, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message chat-message-${sender}`;
        messageDiv.textContent = text;
        this.chatHistory.appendChild(messageDiv);
        this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
    }

    // Clean up when the component is destroyed
    destroy() {
        if (this.presenceInterval) {
            clearInterval(this.presenceInterval);
        }
        if (this.bc) {
            this.bc.close();
        }
        this.peers.forEach((_, peer) => {
            peer.destroy();
        });
    }
}

// Initialize chat when the page is ready
if (document.readyState === 'complete') {
    new BlueskyChat();
} else {
    window.addEventListener('load', () => new BlueskyChat());
} 