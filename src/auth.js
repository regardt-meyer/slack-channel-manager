import { WebClient } from '@slack/web-api';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

export class SlackAuth {
  constructor(token = null) {
    this.token = token;
    this.client = token ? new WebClient(token) : null;
  }

  setToken(token) {
    this.token = token;
    this.client = new WebClient(token);
  }

  async validateToken() {
    if (!this.client) {
      throw new Error('No token provided');
    }

    try {
      const authTest = await this.client.auth.test();
      logger.info('Token validated successfully', {
        teamId: authTest.team_id,
        team: authTest.team,
        user: authTest.user,
        isEnterpriseInstall: authTest.is_enterprise_install
      });

      return {
        valid: true,
        teamId: authTest.team_id,
        teamName: authTest.team,
        userId: authTest.user,
        isEnterpriseInstall: authTest.is_enterprise_install,
        botId: authTest.bot_id
      };
    } catch (error) {
      logger.error('Token validation failed', { error: error.message });
      return {
        valid: false,
        error: error.message
      };
    }
  }

  async discoverWorkspaces() {
    if (!this.client) {
      throw new Error('No token provided');
    }

    try {
      // First check if this is an enterprise install
      const authTest = await this.client.auth.test();
      
      if (!authTest.is_enterprise_install) {
        // Single workspace
        return [{
          id: authTest.team_id,
          name: authTest.team,
          domain: null,
          isEnterprise: false
        }];
      }

      // Enterprise Grid - get all accessible workspaces
      logger.info('Discovering Enterprise Grid workspaces...');
      const teams = await this.client.auth.teams.list();
      
      const workspaces = teams.teams.map(team => ({
        id: team.id,
        name: team.name,
        domain: team.domain,
        isEnterprise: true,
        emailDomain: team.email_domain,
        icon: team.icon
      }));

      logger.info('Workspaces discovered', { 
        count: workspaces.length,
        workspaces: workspaces.map(w => ({ id: w.id, name: w.name }))
      });

      return workspaces;
    } catch (error) {
      logger.error('Failed to discover workspaces', { error: error.message });
      throw error;
    }
  }

  async getWorkspaceChannels(workspaceId = null) {
    if (!this.client) {
      throw new Error('No token provided');
    }

    try {
      const params = {
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 1000
      };

      // Add team_id for Enterprise Grid
      if (workspaceId) {
        params.team_id = workspaceId;
      }

      logger.info('Fetching channels', { workspaceId, params });
      const result = await this.client.conversations.list(params);
      
      return result.channels || [];
    } catch (error) {
      logger.error('Failed to get workspace channels', { 
        workspaceId, 
        error: error.message 
      });
      throw error;
    }
  }

  async getChannelMembers(channelId, workspaceId = null) {
    if (!this.client) {
      throw new Error('No token provided');
    }

    try {
      const params = { channel: channelId };
      
      // Add team_id for Enterprise Grid
      if (workspaceId) {
        params.team_id = workspaceId;
      }

      const result = await this.client.conversations.members(params);
      return result.members || [];
    } catch (error) {
      logger.warn('Failed to get channel members', { 
        channelId, 
        workspaceId, 
        error: error.message 
      });
      return [];
    }
  }

  async getChannelActivity(channelId, workspaceId = null, primaryDays = 30) {
    if (!this.client) {
      throw new Error('No token provided');
    }

    // Calculate multiple timeframes
    const now = Date.now();
    const timeframes = {
      30: Math.floor((now - (30 * 24 * 60 * 60 * 1000)) / 1000),
      60: Math.floor((now - (60 * 24 * 60 * 60 * 1000)) / 1000),
      90: Math.floor((now - (90 * 24 * 60 * 60 * 1000)) / 1000)
    };
    
    // First try to get channel info (works without being member)
    try {
      const params = { channel: channelId };
      if (workspaceId) {
        params.team_id = workspaceId;
      }

      const info = await this.client.conversations.info(params);
      const channel = info.channel;
      
      // Check activity across multiple timeframes
      const lastMessageTime = channel.latest?.ts ? parseFloat(channel.latest.ts) : 0;
      
      const activity = {
        30: lastMessageTime > timeframes[30],
        60: lastMessageTime > timeframes[60],
        90: lastMessageTime > timeframes[90]
      };
      
      logger.debug('Channel multi-timeframe activity checked via info API', {
        channelId,
        lastMessageTime,
        activity
      });

      return {
        hasRecentActivity: activity[primaryDays] || activity[30], // Fallback to 30d if custom timeframe
        activity30d: activity[30],
        activity60d: activity[60],
        activity90d: activity[90],
        lastMessageTimestamp: lastMessageTime,
        daysSinceLastMessage: lastMessageTime > 0 ? Math.floor((now / 1000 - lastMessageTime) / (24 * 60 * 60)) : null,
        accessible: true,
        method: 'info_api'
      };
    } catch (infoError) {
      // Fall back to history API if info fails
      logger.debug('Channel info failed, trying history API', {
        channelId,
        error: infoError.message
      });

      return await this.getChannelHistory(channelId, workspaceId, primaryDays);
    }
  }

  async getChannelHistory(channelId, workspaceId = null, primaryDays = 30) {
    if (!this.client) {
      throw new Error('No token provided');
    }

    const now = Date.now();
    const oldest90 = Math.floor((now - (90 * 24 * 60 * 60 * 1000)) / 1000);
    
    try {
      const params = {
        channel: channelId,
        oldest: oldest90.toString(),
        limit: 100 // Get more messages to analyze timeframes
      };

      // Add team_id for Enterprise Grid
      if (workspaceId) {
        params.team_id = workspaceId;
      }

      const result = await this.client.conversations.history(params);
      const messages = result.messages || [];
      
      // Analyze activity across timeframes
      const timeframes = {
        30: (now - (30 * 24 * 60 * 60 * 1000)) / 1000,
        60: (now - (60 * 24 * 60 * 60 * 1000)) / 1000,
        90: (now - (90 * 24 * 60 * 60 * 1000)) / 1000
      };
      
      const activity = {
        30: messages.some(msg => parseFloat(msg.ts) > timeframes[30]),
        60: messages.some(msg => parseFloat(msg.ts) > timeframes[60]),
        90: messages.some(msg => parseFloat(msg.ts) > timeframes[90])
      };
      
      const lastMessageTime = messages.length > 0 ? parseFloat(messages[0].ts) : 0;
      
      return {
        hasRecentActivity: activity[primaryDays] || activity[30],
        activity30d: activity[30],
        activity60d: activity[60],
        activity90d: activity[90],
        lastMessageTimestamp: lastMessageTime,
        daysSinceLastMessage: lastMessageTime > 0 ? Math.floor((now / 1000 - lastMessageTime) / (24 * 60 * 60)) : null,
        messageCount: messages.length,
        accessible: true,
        method: 'history_api'
      };
    } catch (error) {
      // Handle common access errors gracefully
      if (error.data?.error === 'not_in_channel') {
        logger.debug('Bot not in channel - cannot check history', { 
          channelId, 
          workspaceId 
        });
        return { 
          hasRecentActivity: null,
          activity30d: null,
          activity60d: null,
          activity90d: null,
          lastMessageTimestamp: null,
          daysSinceLastMessage: null,
          messageCount: 0, 
          accessible: false,
          reason: 'not_in_channel',
          method: 'history_api'
        };
      } else if (error.data?.error === 'channel_not_found') {
        return { 
          hasRecentActivity: false,
          activity30d: false,
          activity60d: false,
          activity90d: false,
          lastMessageTimestamp: null,
          daysSinceLastMessage: null,
          messageCount: 0, 
          accessible: false,
          reason: 'channel_not_found',
          method: 'history_api'
        };
      } else {
        logger.warn('Failed to get channel history', { 
          channelId, 
          workspaceId, 
          error: error.message 
        });
        return { 
          hasRecentActivity: null,
          activity30d: null,
          activity60d: null,
          activity90d: null,
          lastMessageTimestamp: null,
          daysSinceLastMessage: null,
          messageCount: 0, 
          accessible: false,
          reason: 'unknown_error',
          method: 'history_api'
        };
      }
    }
  }

  async joinChannel(channelId, workspaceId = null) {
    if (!this.client) {
      throw new Error('No token provided');
    }

    try {
      const params = { channel: channelId };
      
      // Add team_id for Enterprise Grid
      if (workspaceId) {
        params.team_id = workspaceId;
      }

      await this.client.conversations.join(params);
      logger.info('Bot joined channel successfully', { channelId, workspaceId });
      return { success: true };
    } catch (error) {
      // Many channels can't be joined (private, invite-only, etc.)
      logger.debug('Could not join channel', { 
        channelId, 
        workspaceId, 
        error: error.message 
      });
      return { success: false, reason: error.message };
    }
  }

  async archiveChannel(channelId, workspaceId = null) {
    if (!this.client) {
      throw new Error('No token provided');
    }

    try {
      const params = { channel: channelId };
      
      // Add team_id for Enterprise Grid
      if (workspaceId) {
        params.team_id = workspaceId;
      }

      await this.client.conversations.archive(params);
      logger.info('Channel archived successfully', { channelId, workspaceId });
      return { success: true };
    } catch (error) {
      logger.error('Failed to archive channel', { 
        channelId, 
        workspaceId, 
        error: error.message 
      });
      throw error;
    }
  }

  generateAppSetupUrl() {
    const appManifest = {
      display_information: {
        name: "Slack Channel Manager",
        description: "Enterprise workspace management tool for archiving inactive channels",
        background_color: "#2c2d30"
      },
      features: {
        bot_user: {
          display_name: "Channel Manager",
          always_online: false
        }
      },
      oauth_config: {
        scopes: {
          bot: [
            "channels:read",
            "groups:read",
            "conversations.list",
            "conversations.members",
            "conversations.history"
          ]
        }
      },
      settings: {
        org_deploy_enabled: true,
        socket_mode_enabled: false,
        token_rotation_enabled: false
      }
    };

    const manifestJson = encodeURIComponent(JSON.stringify(appManifest));
    return `https://api.slack.com/apps?new_app=1&manifest_json=${manifestJson}`;
  }
}