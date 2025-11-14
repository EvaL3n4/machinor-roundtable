// Machinor Roundtable - Self-Contained Backend Server
// Provides cross-device persistence and real-time WebSocket sync

const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class MachinorBackendServer {
    constructor() {
        this.port = 8765;
        this.server = null;
        this.wss = null;
        this.db = null;
        this.clients = new Map(); // userId -> Set of WebSocket connections
        this.isShuttingDown = false;
        
        console.log('[Machinor Backend] Server instance created');
    }

    /**
     * Initialize and start the backend server
     */
    async start() {
        try {
            console.log('[Machinor Backend] Initializing backend server...');
            
            // Initialize SQLite database
            await this.initializeDatabase();
            
            // Create HTTP server
            this.server = http.createServer((req, res) => {
                this.handleHttpRequest(req, res);
            });
            
            // Attach WebSocket server
            this.wss = new WebSocket.Server({ 
                server: this.server,
                port: this.port,
                path: '/websocket'
            });
            
            this.setupWebSocketHandlers();
            
            // Start listening
            await new Promise((resolve, reject) => {
                this.server.listen(this.port, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
            
            console.log(`[Machinor Backend] ✅ Server started successfully on port ${this.port}`);
            console.log(`[Machinor Backend] 🔗 WebSocket endpoint: ws://localhost:${this.port}/websocket`);
            
            // Send startup notification to any connected clients
            this.broadcastToAll({
                type: 'server_status',
                status: 'started',
                port: this.port,
                timestamp: Date.now()
            });
            
            return true;
            
        } catch (error) {
            console.error('[Machinor Backend] ❌ Failed to start server:', error);
            return false;
        }
    }

    /**
     * Initialize SQLite database with tables
     */
    async initializeDatabase() {
        return new Promise((resolve, reject) => {
            const dbPath = path.join(__dirname, 'machinor_storage.db');
            console.log(`[Machinor Backend] 📂 Initializing database at: ${dbPath}`);
            
            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    console.error('[Machinor Backend] Database connection error:', err);
                    reject(err);
                    return;
                }
                
                console.log('[Machinor Backend] ✅ SQLite database connected');
                this.createDatabaseTables(resolve, reject);
            });
        });
    }

    /**
     * Create database tables
     */
    createDatabaseTables(resolve, reject) {
        const createProfilesTable = `
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                character_id INTEGER NOT NULL,
                character_name TEXT,
                chat_id TEXT NOT NULL,
                title TEXT,
                
                -- Current plot data
                current_plot TEXT,
                current_status TEXT DEFAULT 'ready',
                current_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                current_options TEXT DEFAULT '{}',
                
                -- Settings and UI state
                auto_approve_timeout INTEGER DEFAULT 5000,
                history_limit INTEGER DEFAULT 5,
                recent_directions TEXT DEFAULT '[]',
                sidebar_collapsed BOOLEAN DEFAULT 1,
                plot_style TEXT DEFAULT 'natural',
                plot_intensity TEXT DEFAULT 'moderate',
                
                -- Story intelligence
                character_analysis TEXT,
                world_context TEXT,
                arc_status TEXT DEFAULT '{}',
                character_count TEXT,
                
                -- Metadata
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
                version INTEGER DEFAULT 1,
                sync_status TEXT DEFAULT 'synced',
                
                UNIQUE(user_id, character_id, chat_id)
            )
        `;

        const createHistoryTable = `
            CREATE TABLE IF NOT EXISTS plot_history (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL,
                plot_text TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'ready',
                injected BOOLEAN DEFAULT 0,
                edited BOOLEAN DEFAULT 0,
                source TEXT DEFAULT 'generated',
                
                FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
            )
        `;

        const createIndexes = `
            CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
            CREATE INDEX IF NOT EXISTS idx_profiles_last_accessed ON profiles(last_accessed);
            CREATE INDEX IF NOT EXISTS idx_history_profile_id ON plot_history(profile_id);
            CREATE INDEX IF NOT EXISTS idx_history_timestamp ON plot_history(timestamp);
        `;

        this.db.serialize(() => {
            this.db.run(createProfilesTable, (err) => {
                if (err) {
                    console.error('[Machinor Backend] Failed to create profiles table:', err);
                    reject(err);
                    return;
                }
                
                this.db.run(createHistoryTable, (err) => {
                    if (err) {
                        console.error('[Machinor Backend] Failed to create history table:', err);
                        reject(err);
                        return;
                    }
                    
                    this.db.exec(createIndexes, (err) => {
                        if (err) {
                            console.error('[Machinor Backend] Failed to create indexes:', err);
                            reject(err);
                            return;
                        }
                        
                        console.log('[Machinor Backend] ✅ Database tables created successfully');
                        resolve();
                    });
                });
            });
        });
    }

    /**
     * Handle HTTP requests
     */
    handleHttpRequest(req, res) {
        const url = new URL(req.url, `http://localhost:${this.port}`);
        let pathname = url.pathname;

        // Handle proxy path routing - strip /api/backend prefix if present
        if (pathname.startsWith('/api/backend')) {
            pathname = pathname.replace('/api/backend', '');
            if (pathname === '') {
                pathname = '/';
            }
        }

        // Set CORS headers for cross-origin requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Allow-Credentials', 'false');
        res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        console.log(`[Machinor Backend] HTTP ${req.method} ${pathname}`);

        try {
            switch (pathname) {
                case '/':
                case '/api/status':
                    this.handleStatus(req, res);
                    break;
                case '/api/profiles':
                case '/profiles':
                    this.handleProfiles(req, res);
                    break;
                case '/api/health':
                case '/health':
                    this.handleHealth(req, res);
                    break;
                default:
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
            }
        } catch (error) {
            console.error('[Machinor Backend] HTTP request error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
    }

    /**
     * Handle server status endpoint
     */
    handleStatus(req, res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'running',
            port: this.port,
            clients: this.clients.size,
            uptime: process.uptime(),
            timestamp: Date.now()
        }));
    }

    /**
     * Handle health check endpoint
     */
    handleHealth(req, res) {
        const dbStatus = this.db ? 'connected' : 'disconnected';
        const wsStatus = this.wss ? 'running' : 'stopped';
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            database: dbStatus,
            websocket: wsStatus,
            timestamp: Date.now()
        }));
    }

    /**
     * Handle profile management endpoints
     */
    handleProfiles(req, res) {
        const url = new URL(req.url, `http://localhost:${this.port}`);
        
        if (req.method === 'GET') {
            this.getUserProfiles(req, res);
        } else if (req.method === 'POST') {
            this.saveProfile(req, res);
        } else {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        }
    }

    /**
     * Get profiles for a user
     */
    getUserProfiles(req, res) {
        const url = new URL(req.url, `http://localhost:${this.port}`);
        const userId = url.searchParams.get('userId');
        const profileId = url.searchParams.get('profileId');

        console.log(`[Machinor Backend] 🔍 GET PROFILES:`, { userId, profileId });

        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'userId parameter required' }));
            return;
        }

        let query, params;
        
        if (profileId) {
            // Get specific profile
            query = `
                SELECT p.*,
                       COUNT(h.id) as history_count
                FROM profiles p
                LEFT JOIN plot_history h ON p.id = h.profile_id
                WHERE p.user_id = ? AND p.id = ?
                GROUP BY p.id
                ORDER BY p.last_accessed DESC
                LIMIT 1
            `;
            params = [userId, profileId];
        } else {
            // Get all user profiles
            query = `
                SELECT p.*,
                       COUNT(h.id) as history_count
                FROM profiles p
                LEFT JOIN plot_history h ON p.id = h.profile_id
                WHERE p.user_id = ?
                GROUP BY p.id
                ORDER BY p.last_accessed DESC
                LIMIT 50
            `;
            params = [userId];
        }

        this.db.all(query, params, (err, rows) => {
            if (err) {
                console.error('[Machinor Backend] Get profiles error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Database error' }));
                return;
            }

            console.log(`[Machinor Backend] 📊 Found ${rows.length} profiles`);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                profiles: rows.map(row => ({
                    ...row,
                    recent_directions: JSON.parse(row.recent_directions || '[]'),
                    current_options: JSON.parse(row.current_options || '{}'),
                    arc_status: JSON.parse(row.arc_status || '{}')
                }))
            }));
        });
    }

    /**
     * Save profile data
     */
    saveProfile(req, res) {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const profileData = JSON.parse(body);
                const { userId, characterId, chatId, profile } = profileData;
                
                if (!userId || !characterId || !chatId || !profile) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields' }));
                    return;
                }

                // Generate profile ID
                const profileId = `${userId}_${characterId}_${chatId}`;
                
                // Prepare data for insertion
                const dbProfile = {
                    id: profileId,
                    user_id: userId,
                    character_id: characterId,
                    character_name: profile.characterName || 'Unknown',
                    chat_id: chatId,
                    title: profile.title || '',
                    
                    // Current plot
                    current_plot: profile.currentPlot?.text || null,
                    current_status: profile.currentPlot?.status || 'ready',
                    current_timestamp: profile.currentPlot?.timestamp ? 
                        new Date(profile.currentPlot.timestamp).toISOString() : 
                        new Date().toISOString(),
                    current_options: JSON.stringify(profile.currentPlot?.options || {}),
                    
                    // Settings
                    auto_approve_timeout: profile.settings?.autoApproveTimeout || 5000,
                    history_limit: profile.settings?.historyLimit || 5,
                    recent_directions: JSON.stringify(profile.settings?.recentDirections || []),
                    sidebar_collapsed: profile.settings?.sidebarCollapsed ? 1 : 0,
                    plot_style: profile.settings?.plotStyle || 'natural',
                    plot_intensity: profile.settings?.plotIntensity || 'moderate',
                    
                    // Story intelligence
                    character_analysis: profile.storyIntelligence?.characterAnalysis || null,
                    world_context: profile.storyIntelligence?.worldContext || null,
                    arc_status: JSON.stringify(profile.storyIntelligence?.arcStatus || {}),
                    character_count: profile.storyIntelligence?.characterCount || null,
                    
                    // Metadata
                    last_accessed: new Date().toISOString(),
                    last_modified: new Date().toISOString(),
                    version: (profile.version || 1) + 1,
                    sync_status: 'synced'
                };

                // Insert or update profile
                const query = `
                    INSERT OR REPLACE INTO profiles (
                        id, user_id, character_id, character_name, chat_id, title,
                        current_plot, current_status, current_timestamp, current_options,
                        auto_approve_timeout, history_limit, recent_directions, 
                        sidebar_collapsed, plot_style, plot_intensity,
                        character_analysis, world_context, arc_status, character_count,
                        last_accessed, last_modified, version, sync_status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                const params = [
                    dbProfile.id, dbProfile.user_id, dbProfile.character_id, 
                    dbProfile.character_name, dbProfile.chat_id, dbProfile.title,
                    dbProfile.current_plot, dbProfile.current_status, 
                    dbProfile.current_timestamp, dbProfile.current_options,
                    dbProfile.auto_approve_timeout, dbProfile.history_limit,
                    dbProfile.recent_directions, dbProfile.sidebar_collapsed,
                    dbProfile.plot_style, dbProfile.plot_intensity,
                    dbProfile.character_analysis, dbProfile.world_context,
                    dbProfile.arc_status, dbProfile.character_count,
                    dbProfile.last_accessed, dbProfile.last_modified,
                    dbProfile.version, dbProfile.sync_status
                ];

                this.db.run(query, params, function(err) {
                    if (err) {
                        console.error('[Machinor Backend] Save profile error:', err);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Database error' }));
                        return;
                    }

                    console.log(`[Machinor Backend] ✅ Profile saved: ${profileId}`);
                    
                    // Notify other clients about profile update
                    this.broadcastToUser(userId, {
                        type: 'profile_updated',
                        profileId: profileId,
                        data: profileData,
                        timestamp: Date.now()
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: true, 
                        profileId: profileId,
                        version: dbProfile.version
                    }));
                }.bind(this));

            } catch (error) {
                console.error('[Machinor Backend] Parse profile error:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    }

    /**
     * Setup WebSocket event handlers
     */
    setupWebSocketHandlers() {
        this.wss.on('connection', (ws, req) => {
            this.handleWebSocketConnection(ws, req);
        });

        this.wss.on('error', (error) => {
            console.error('[Machinor Backend] WebSocket server error:', error);
        });
    }

    /**
     * Handle new WebSocket connection
     */
    handleWebSocketConnection(ws, req) {
        let url;
        try {
            // Handle both direct WebSocket and proxy WebSocket connections
            const isProxy = req.url.includes('/api/backend') || req.url.includes('/proxy');
            const baseUrl = isProxy ? `ws://localhost:${this.port}/api/backend` : `ws://localhost:${this.port}`;
            url = new URL(req.url, baseUrl);
        } catch (error) {
            console.error('[Machinor Backend] WebSocket URL parse error:', error);
            ws.close(1008, 'Invalid URL');
            return;
        }
        
        const userId = url.searchParams.get('userId');
        
        console.log(`[Machinor Backend] 🔗 WebSocket connection from user: ${userId}`);
        console.log(`[Machinor Backend] WebSocket URL: ${req.url}`);
        
        if (!userId) {
            ws.close(1008, 'userId required');
            return;
        }

        // Add to clients
        if (!this.clients.has(userId)) {
            this.clients.set(userId, new Set());
        }
        this.clients.get(userId).add(ws);

        // Store connection info
        ws.userId = userId;
        ws.isProxy = req.url.includes('/api/backend') || req.url.includes('/proxy');

        // Send connection confirmation
        ws.send(JSON.stringify({
            type: 'connection_confirmed',
            userId: userId,
            timestamp: Date.now(),
            serverPort: this.port,
            proxyMode: ws.isProxy
        }));

        // Setup message handler
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleWebSocketMessage(ws, message);
            } catch (error) {
                console.error('[Machinor Backend] WebSocket message parse error:', error);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Invalid JSON format',
                    timestamp: Date.now()
                }));
            }
        });

        // Handle close
        ws.on('close', () => {
            console.log(`[Machinor Backend] ❌ WebSocket connection closed for user: ${userId}`);
            
            const userClients = this.clients.get(userId);
            if (userClients) {
                userClients.delete(ws);
                if (userClients.size === 0) {
                    this.clients.delete(userId);
                }
            }
        });

        // Handle errors
        ws.on('error', (error) => {
            console.error(`[Machinor Backend] WebSocket error for user ${userId}:`, error);
        });
    }

    /**
     * Handle WebSocket messages
     */
    handleWebSocketMessage(ws, message) {
        const { type, userId, data } = message;
        
        console.log(`[Machinor Backend] 📨 WebSocket message: ${type} from ${userId}`);

        switch (type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                break;
                
            case 'subscribe_profile':
                // Client wants to subscribe to profile updates
                ws.subscriptions = ws.subscriptions || new Set();
                ws.subscriptions.add(data.profileId);
                ws.send(JSON.stringify({
                    type: 'subscription_confirmed',
                    profileId: data.profileId,
                    timestamp: Date.now()
                }));
                break;
                
            case 'unsubscribe_profile':
                if (ws.subscriptions) {
                    ws.subscriptions.delete(data.profileId);
                }
                break;
                
            case 'profile_update':
                // Broadcast to other subscribers
                this.broadcastToUser(userId, {
                    type: 'profile_updated',
                    profileId: data.profileId,
                    data: data.profileData,
                    timestamp: Date.now(),
                    source: 'websocket'
                });
                break;
                
            case 'get_profile':
                // Load profile and send to client
                this.loadProfileAndSend(data.profileId, userId, ws);
                break;
                
            case 'broadcast_presence':
                // Let other clients know user is online
                this.broadcastToUser(userId, {
                    type: 'user_presence',
                    userId: userId,
                    status: 'online',
                    timestamp: Date.now()
                }, ws); // Exclude sender
                break;
                
            default:
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Unknown message type: ${type}`,
                    timestamp: Date.now()
                }));
        }
    }

    /**
     * Load profile from database and send to client
     */
    loadProfileAndSend(profileId, userId, ws) {
        const query = `
            SELECT p.*, 
                   GROUP_CONCAT(h.id || ':' || h.plot_text || ':' || h.timestamp) as history_data
            FROM profiles p
            LEFT JOIN plot_history h ON p.id = h.profile_id
            WHERE p.id = ? AND p.user_id = ?
            GROUP BY p.id
        `;

        this.db.get(query, [profileId, userId], (err, row) => {
            if (err) {
                console.error('[Machinor Backend] Load profile error:', err);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Database error',
                    timestamp: Date.now()
                }));
                return;
            }

            if (!row) {
                ws.send(JSON.stringify({
                    type: 'profile_not_found',
                    profileId: profileId,
                    timestamp: Date.now()
                }));
                return;
            }

            // Parse complex fields
            const profileData = {
                id: row.id,
                userId: row.user_id,
                characterId: row.character_id,
                characterName: row.character_name,
                chatId: row.chat_id,
                title: row.title,
                
                currentPlot: {
                    text: row.current_plot,
                    status: row.current_status,
                    timestamp: new Date(row.current_timestamp).getTime(),
                    options: JSON.parse(row.current_options || '{}')
                },
                
                settings: {
                    autoApproveTimeout: row.auto_approve_timeout,
                    historyLimit: row.history_limit,
                    recentDirections: JSON.parse(row.recent_directions || '[]'),
                    sidebarCollapsed: !!row.sidebar_collapsed,
                    plotStyle: row.plot_style,
                    plotIntensity: row.plot_intensity
                },
                
                storyIntelligence: {
                    characterAnalysis: row.character_analysis,
                    worldContext: row.world_context,
                    arcStatus: JSON.parse(row.arc_status || '{}'),
                    characterCount: row.character_count
                },
                
                plotHistory: this.parseHistoryData(row.history_data),
                version: row.version,
                lastModified: new Date(row.last_modified).getTime()
            };

            ws.send(JSON.stringify({
                type: 'profile_data',
                profileId: profileId,
                data: profileData,
                timestamp: Date.now()
            }));
        });
    }

    /**
     * Parse history data from database
     */
    parseHistoryData(historyData) {
        if (!historyData) return [];
        
        return historyData.split(',').map(entry => {
            const [id, text, timestamp] = entry.split(':');
            return {
                id: id,
                text: text,
                timestamp: new Date(timestamp).getTime(),
                status: 'ready',
                injected: false,
                edited: false,
                source: 'generated'
            };
        });
    }

    /**
     * Broadcast message to all clients of a user
     */
    broadcastToUser(userId, message, excludeWs = null) {
        const userClients = this.clients.get(userId);
        if (!userClients) return;

        const messageStr = JSON.stringify(message);
        userClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
                client.send(messageStr);
            }
        });
    }

    /**
     * Broadcast message to all connected clients
     */
    broadcastToAll(message) {
        const messageStr = JSON.stringify(message);
        this.clients.forEach((userClients, userId) => {
            userClients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(messageStr);
                }
            });
        });
    }

    /**
     * Shutdown server gracefully
     */
    async shutdown() {
        if (this.isShuttingDown) return;
        
        this.isShuttingDown = true;
        console.log('[Machinor Backend] 🔄 Shutting down server...');

        // Notify all clients
        this.broadcastToAll({
            type: 'server_shutdown',
            timestamp: Date.now()
        });

        // Close WebSocket connections
        if (this.wss) {
            this.wss.clients.forEach(client => {
                client.close(1001, 'Server shutting down');
            });
        }

        // Close HTTP server
        if (this.server) {
            this.server.close();
        }

        // Close database connection
        if (this.db) {
            this.db.close();
        }

        console.log('[Machinor Backend] ✅ Server shutdown complete');
    }
}

// Create global instance for shutdown handling
let backendInstance = null;

/**
 * Initialize and start the backend server
 */
async function startMachinorBackend() {
    if (backendInstance && !backendInstance.isShuttingDown) {
        console.log('[Machinor Backend] Server already running');
        return backendInstance;
    }

    backendInstance = new MachinorBackendServer();
    const success = await backendInstance.start();
    
    if (success) {
        return backendInstance;
    } else {
        throw new Error('Failed to start backend server');
    }
}

/**
 * Stop the backend server
 */
async function stopMachinorBackend() {
    if (backendInstance) {
        await backendInstance.shutdown();
        backendInstance = null;
    }
}

// Handle process shutdown
process.on('SIGINT', async () => {
    console.log('\n[Machinor Backend] Received SIGINT, shutting down...');
    await stopMachinorBackend();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[Machinor Backend] Received SIGTERM, shutting down...');
    await stopMachinorBackend();
    process.exit(0);
});

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        startMachinorBackend,
        stopMachinorBackend,
        MachinorBackendServer
    };
}