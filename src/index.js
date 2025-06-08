import { ArgumentParser } from 'argparse';
import winston from 'winston';
import { DateTime } from 'luxon';
import dotenv from 'dotenv';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from './config.js';
import { SlackAuth } from './auth.js';

dotenv.config();

// Configure structured logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    // Console transport with readable format
    new winston.transports.Console({
      level: 'warn', // Only show warnings and errors on console
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${level}: ${message}${metaStr}`;
        })
      )
    }),
    // File transport with full JSON for analysis
    new winston.transports.File({ 
      filename: 'slack-channel-manager.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
});

class EnterpriseChannelManager {
  constructor(auth, config) {
    this.auth = auth;
    this.config = {
      dryRun: true,
      inactiveDays: 30,
      minMembers: 0,
      maxMembersForInactivity: 10, // Archive channels with ≤ 10 members if inactive
      excludePatterns: ['general', 'random', 'announcements'],
      ...config
    };
    this.configManager = new ConfigManager();
  }

  async initialize() {
    await this.configManager.load();
    
    const authConfig = this.configManager.getAuth();
    if (!authConfig) {
      throw new Error('No authentication configuration found. Please run: npm run setup');
    }

    this.auth.setToken(authConfig.token);
    this.workspaces = this.configManager.getWorkspaces();
    this.selectedWorkspaces = this.configManager.getSelectedWorkspaces();

    logger.info(`Manager initialized - ${this.selectedWorkspaces.length}/${this.workspaces.length} workspaces selected`, {
      workspaceCount: this.workspaces.length,
      selectedCount: this.selectedWorkspaces.length,
      config: this.config
    });
  }

  isChannelExcluded(channelName) {
    return this.config.excludePatterns.some(pattern => 
      channelName.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  async analyzeChannel(channel, workspaceId) {
    const members = await this.auth.getChannelMembers(channel.id, workspaceId);
    const history = await this.auth.getChannelActivity(channel.id, workspaceId, this.config.inactiveDays);
    
    const analysis = {
      workspaceId,
      channelId: channel.id,
      channelName: channel.name,
      memberCount: members.length,
      hasRecentActivity: history.hasRecentActivity,
      activity30d: history.activity30d,
      activity60d: history.activity60d,
      activity90d: history.activity90d,
      daysSinceLastMessage: history.daysSinceLastMessage,
      historyAccessible: history.accessible,
      isExcluded: this.isChannelExcluded(channel.name),
      shouldArchive: false,
      created: channel.created,
      purpose: channel.purpose?.value || '',
      topic: channel.topic?.value || '',
      isPrivate: channel.is_private || false
    };

    // Determine if channel should be archived using flexible rules
    if (analysis.isExcluded) {
      analysis.shouldArchive = false;
      analysis.archiveReason = 'Excluded by pattern';
    } else if (analysis.historyAccessible) {
      // Can check history - use tiered rules based on member count
      const hasZeroMembers = analysis.memberCount <= this.config.minMembers;
      const hasLowMembers = analysis.memberCount <= this.config.maxMembersForInactivity;
      const isInactive = !analysis.hasRecentActivity;
      
      if (hasZeroMembers && isInactive) {
        analysis.shouldArchive = true;
        analysis.archiveReason = `Zero members and inactive ${this.config.inactiveDays}+ days`;
      } else if (hasLowMembers && !analysis.activity60d) {
        analysis.shouldArchive = true;
        analysis.archiveReason = `≤${this.config.maxMembersForInactivity} members and inactive 60+ days`;
      } else if (hasLowMembers && !analysis.activity90d) {
        analysis.shouldArchive = true;
        analysis.archiveReason = `≤${this.config.maxMembersForInactivity} members and inactive 90+ days`;
      } else {
        analysis.shouldArchive = false;
        analysis.archiveReason = 'Does not meet archiving criteria';
      }
    } else {
      // Cannot check history - only archive if 0 members (very conservative)
      analysis.shouldArchive = analysis.memberCount === 0;
      analysis.archiveReason = analysis.memberCount === 0 
        ? 'No members (history inaccessible)' 
        : 'Skipped (bot not in channel, cannot verify activity)';
    }

    // Log analysis with clean message and structured data
    logger.info(`Channel analyzed: ${analysis.channelName}`, {
      workspaceId: analysis.workspaceId,
      channelId: analysis.channelId,
      memberCount: analysis.memberCount,
      hasRecentActivity: analysis.hasRecentActivity,
      shouldArchive: analysis.shouldArchive,
      historyAccessible: analysis.historyAccessible
    });
    return analysis;
  }

  displayChannelAnalysis(channel, analysis) {
    const indent = '    ';
    
    // Channel basic info
    console.log(chalk.gray(`${indent}📊 Members: ${analysis.memberCount}`));
    console.log(chalk.gray(`${indent}🔒 Type: ${analysis.isPrivate ? 'Private' : 'Public'}`));
    
    // Multi-timeframe activity status
    if (analysis.historyAccessible) {
      if (analysis.daysSinceLastMessage !== null) {
        console.log(chalk.gray(`${indent}⏰ Last message: ${analysis.daysSinceLastMessage} days ago`));
      } else {
        console.log(chalk.gray(`${indent}⏰ Last message: No messages found`));
      }
      
      const activity30Color = analysis.activity30d ? chalk.green : chalk.red;
      const activity60Color = analysis.activity60d ? chalk.green : chalk.red;
      const activity90Color = analysis.activity90d ? chalk.green : chalk.red;
      
      console.log(chalk.gray(`${indent}📈 Activity timeline:`));
      console.log(chalk.gray(`${indent}   • 30d: ${activity30Color(analysis.activity30d ? 'Active' : 'Inactive')}`));
      console.log(chalk.gray(`${indent}   • 60d: ${activity60Color(analysis.activity60d ? 'Active' : 'Inactive')}`));
      console.log(chalk.gray(`${indent}   • 90d: ${activity90Color(analysis.activity90d ? 'Active' : 'Inactive')}`));
      
      // Debug info for troubleshooting  
      if (process.env.DEBUG === 'true') {
        console.log(chalk.dim(`${indent}🔧 Debug: daysSinceLastMessage=${analysis.daysSinceLastMessage}`));
      }
    } else {
      console.log(chalk.gray(`${indent}📈 Activity: ${chalk.yellow('Unknown (bot not in channel)')}`));
    }
    
    // Exclusion check
    if (analysis.isExcluded) {
      console.log(chalk.gray(`${indent}🚫 Excluded: ${chalk.red('Yes')} (matches exclusion pattern)`));
    } else {
      console.log(chalk.gray(`${indent}🚫 Excluded: ${chalk.green('No')}`));
    }
    
    // Archive decision logic
    console.log(chalk.gray(`${indent}📝 Decision logic:`));
    
    if (analysis.isExcluded) {
      console.log(chalk.yellow(`${indent}   → Skip: ${analysis.archiveReason}`));
    } else if (analysis.historyAccessible) {
      // Show tiered rules with actual logic
      const hasZeroMembers = analysis.memberCount <= this.config.minMembers;
      const hasLowMembers = analysis.memberCount <= this.config.maxMembersForInactivity;
      
      // Rule checks match the actual logic
      const rule1Pass = hasZeroMembers && !analysis.hasRecentActivity;
      const rule2Pass = hasLowMembers && !analysis.activity60d;
      const rule3Pass = hasLowMembers && !analysis.activity90d;
      
      console.log(chalk.gray(`${indent}   Rule 1: Members ≤ ${this.config.minMembers} + Inactive ${this.config.inactiveDays}d: ${rule1Pass ? chalk.green('✓') : chalk.red('✗')}`));
      console.log(chalk.gray(`${indent}   Rule 2: Members ≤ ${this.config.maxMembersForInactivity} + Inactive 60d: ${rule2Pass ? chalk.green('✓') : chalk.red('✗')}`));
      console.log(chalk.gray(`${indent}   Rule 3: Members ≤ ${this.config.maxMembersForInactivity} + Inactive 90d: ${rule3Pass ? chalk.green('✓') : chalk.red('✗')}`));
      
      // Show which rule triggered (if any)
      if (rule1Pass) {
        console.log(chalk.yellow(`${indent}   → Archive: Rule 1 triggered - ${analysis.archiveReason}`));
      } else if (rule2Pass) {
        console.log(chalk.yellow(`${indent}   → Archive: Rule 2 triggered - ${analysis.archiveReason}`));
      } else if (rule3Pass) {
        console.log(chalk.yellow(`${indent}   → Archive: Rule 3 triggered - ${analysis.archiveReason}`));
      } else {
        console.log(chalk.green(`${indent}   → Keep: ${analysis.archiveReason}`));
      }
    } else {
      // Limited analysis
      const memberCheck = analysis.memberCount === 0;
      console.log(chalk.gray(`${indent}   • Members = 0: ${memberCheck ? chalk.green('✓') : chalk.red('✗')}`));
      console.log(chalk.gray(`${indent}   • Activity check: ${chalk.yellow('Skipped (no access)')}`));
      
      console.log(analysis.shouldArchive 
        ? chalk.yellow(`${indent}   → Archive: ${analysis.archiveReason}`)
        : chalk.green(`${indent}   → Keep: ${analysis.archiveReason}`)
      );
    }
    
    // Final decision
    if (analysis.shouldArchive) {
      console.log(chalk.yellow(`${indent}🗃️  WILL ARCHIVE - ${analysis.archiveReason}`));
    } else {
      console.log(chalk.green(`${indent}✅ WILL KEEP - ${analysis.archiveReason}`));
    }
    
    console.log(''); // Empty line for spacing
  }

  async archiveChannel(channelId, channelName, workspaceId) {
    if (this.config.dryRun) {
      logger.info('DRY RUN: Would archive channel', { channelId, channelName, workspaceId });
      return { archived: false, dryRun: true };
    }

    try {
      await this.auth.archiveChannel(channelId, workspaceId);
      logger.info('Channel archived', { channelId, channelName, workspaceId });
      return { archived: true, dryRun: false };
    } catch (error) {
      logger.error('Failed to archive channel', { 
        channelId, 
        channelName, 
        workspaceId,
        error: error.message 
      });
      throw error;
    }
  }

  async processWorkspace(workspace) {
    console.log(chalk.cyan(`\n📊 Processing workspace: ${workspace.name}`));
    
    const spinner = ora(`Fetching channels from ${workspace.name}...`).start();
    
    try {
      const channels = await this.auth.getWorkspaceChannels(workspace.id);
      spinner.succeed(`Found ${channels.length} channels in ${workspace.name}`);

      const results = {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        total: channels.length,
        analyzed: 0,
        toArchive: 0,
        archived: 0,
        errors: 0,
        channels: []
      };

      for (const channel of channels) {
        try {
          console.log(chalk.cyan(`  🔍 Analyzing: ${channel.name}`));
          
          const analysis = await this.analyzeChannel(channel, workspace.id);
          results.analyzed++;
          results.channels.push(analysis);

          // Show detailed analysis
          this.displayChannelAnalysis(channel, analysis);

          if (analysis.shouldArchive) {
            results.toArchive++;
            await this.archiveChannel(channel.id, channel.name, workspace.id);
            results.archived++;
          }
        } catch (error) {
          results.errors++;
          logger.error('Error processing channel', { 
            workspaceId: workspace.id,
            channelName: channel.name, 
            error: error.message 
          });
          console.log(chalk.red(`  ❌ Error processing ${channel.name}: ${error.message}`));
        }
      }

      return results;
    } catch (error) {
      spinner.fail(`Failed to process workspace ${workspace.name}: ${error.message}`);
      throw error;
    }
  }

  async run() {
    await this.initialize();

    console.log(chalk.green.bold('\n🚀 Enterprise Channel Manager\n'));
    console.log(chalk.gray(`Mode: ${this.config.dryRun ? 'DRY RUN' : 'LIVE EXECUTION'}`));
    console.log(chalk.gray(`Archive Rules:`));
    console.log(chalk.gray(`  • Zero members + inactive ${this.config.inactiveDays}+ days`));
    console.log(chalk.gray(`  • ≤${this.config.maxMembersForInactivity} members + inactive 60+ days`));
    console.log(chalk.gray(`  • ≤${this.config.maxMembersForInactivity} members + inactive 90+ days`));
    console.log(chalk.gray(`Selected workspaces: ${this.selectedWorkspaces.length}\n`));

    logger.info(`Starting channel management run across ${this.selectedWorkspaces.length} workspaces`, { 
      config: this.config,
      selectedWorkspaces: this.selectedWorkspaces 
    });

    const overallResults = {
      workspaces: [],
      totalChannels: 0,
      totalAnalyzed: 0,
      totalToArchive: 0,
      totalArchived: 0,
      totalErrors: 0
    };

    for (const workspaceId of this.selectedWorkspaces) {
      const workspace = this.workspaces.find(w => w.id === workspaceId);
      if (!workspace) {
        console.log(chalk.red(`❌ Workspace ${workspaceId} not found in configuration`));
        continue;
      }

      try {
        const workspaceResults = await this.processWorkspace(workspace);
        overallResults.workspaces.push(workspaceResults);
        overallResults.totalChannels += workspaceResults.total;
        overallResults.totalAnalyzed += workspaceResults.analyzed;
        overallResults.totalToArchive += workspaceResults.toArchive;
        overallResults.totalArchived += workspaceResults.archived;
        overallResults.totalErrors += workspaceResults.errors;

        console.log(chalk.green(`✅ ${workspace.name}: ${workspaceResults.archived}/${workspaceResults.toArchive} channels archived`));
      } catch (error) {
        overallResults.totalErrors++;
        console.log(chalk.red(`❌ Failed to process workspace ${workspace.name}: ${error.message}`));
      }
    }

    logger.info(`Channel management completed - ${overallResults.totalArchived} channels archived`, overallResults);
    return overallResults;
  }
}

async function checkConfiguration() {
  const config = new ConfigManager();
  await config.load();
  
  if (!config.isConfigured()) {
    console.log(chalk.red('❌ No configuration found.'));
    console.log(chalk.yellow('Please run the setup wizard first:'));
    console.log(chalk.cyan('  npm run setup\\n'));
    process.exit(1);
  }

  return config;
}

async function main() {
  const parser = new ArgumentParser({
    description: 'Enterprise Slack Channel Manager - Archive inactive channels across workspaces'
  });

  parser.add_argument('--dry-run', {
    action: 'store_true',
    default: true,
    help: 'Run in dry-run mode (default: true)'
  });

  parser.add_argument('--execute', {
    action: 'store_true',
    help: 'Actually execute archiving (overrides dry-run)'
  });

  parser.add_argument('--inactive-days', {
    type: 'int',
    default: 30,
    help: 'Days of inactivity before archiving (default: 30)'
  });

  parser.add_argument('--min-members', {
    type: 'int',
    default: 0,
    help: 'Minimum members threshold for immediate archiving (default: 0)'
  });

  parser.add_argument('--max-members-inactive', {
    type: 'int',
    default: 10,
    help: 'Maximum members for channels to be archived when inactive (default: 10)'
  });

  parser.add_argument('--workspace', {
    type: 'str',
    help: 'Target specific workspace ID (default: all configured workspaces)'
  });

  parser.add_argument('--join-channels', {
    action: 'store_true',
    help: 'Attempt to join public channels for better activity analysis'
  });

  const args = parser.parse_args();

  try {
    await checkConfiguration();

    const auth = new SlackAuth();
    const config = {
      dryRun: !args.execute,
      inactiveDays: args.inactive_days,
      minMembers: args.min_members,
      maxMembersForInactivity: args.max_members_inactive
    };

    const manager = new EnterpriseChannelManager(auth, config);
    
    // Override selected workspaces if specific workspace provided
    if (args.workspace) {
      await manager.initialize();
      const workspace = manager.workspaces.find(w => w.id === args.workspace || w.name === args.workspace);
      if (!workspace) {
        console.log(chalk.red(`❌ Workspace '${args.workspace}' not found`));
        console.log(chalk.gray('Available workspaces:'));
        manager.workspaces.forEach(w => console.log(`  • ${w.name} (${w.id})`));
        process.exit(1);
      }
      manager.selectedWorkspaces = [workspace.id];
    }

    const results = await manager.run();
    
    // Summary
    console.log(chalk.green.bold('\n📋 Summary Report'));
    console.log(chalk.gray('================'));
    console.log(`Workspaces processed: ${results.workspaces.length}`);
    console.log(`Total channels analyzed: ${results.totalAnalyzed}`);
    console.log(`Channels to archive: ${results.totalToArchive}`);
    console.log(`Channels archived: ${results.totalArchived}`);
    console.log(`Errors: ${results.totalErrors}`);
    console.log(`Mode: ${config.dryRun ? 'DRY RUN' : 'LIVE EXECUTION'}`);

    if (results.totalToArchive > 0 && config.dryRun) {
      console.log(chalk.yellow('\n💡 Run with --execute to actually archive channels'));
    }

  } catch (error) {
    logger.error('Application error', { error: error.message });
    console.error(chalk.red('\n❌ Error:'), error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}