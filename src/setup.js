import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import path from 'path';
import { ConfigManager } from './config.js';
import { SlackAuth } from './auth.js';

class SetupWizard {
  constructor() {
    this.config = new ConfigManager();
    this.auth = new SlackAuth();
  }

  async run() {
    console.log(chalk.cyan.bold('\n🚀 Slack Channel Manager Setup Wizard\n'));
    console.log(chalk.gray('This wizard will help you set up the Slack Channel Manager for Enterprise Grid.\n'));

    await this.config.load();

    if (this.config.isConfigured()) {
      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'Configuration already exists. What would you like to do?',
        choices: [
          { name: 'View current configuration', value: 'view' },
          { name: 'Add/remove workspaces', value: 'workspaces' },
          { name: 'Reconfigure authentication', value: 'reauth' },
          { name: 'Reset all configuration', value: 'reset' },
          { name: 'Exit', value: 'exit' }
        ]
      }]);

      switch (action) {
        case 'view':
          await this.showCurrentConfig();
          return;
        case 'workspaces':
          await this.manageWorkspaces();
          return;
        case 'reset':
          await this.resetConfig();
          break;
        case 'reauth':
          break; // Continue with auth setup
        case 'exit':
          return;
      }
    }

    await this.setupAuthentication();
    await this.discoverWorkspaces();
    await this.selectWorkspaces();
    await this.testConfiguration();
    await this.showSetupComplete();
  }

  async showCurrentConfig() {
    const auth = this.config.getAuth();
    const workspaces = this.config.getWorkspaces();
    const selectedWorkspaces = this.config.getSelectedWorkspaces();

    console.log(chalk.green('\n✅ Current Configuration:'));
    console.log(chalk.gray('Config file:'), this.config.getConfigPath());
    
    if (auth) {
      console.log(chalk.gray('Token type:'), auth.tokenType);
      console.log(chalk.gray('Token:'), auth.token.substring(0, 12) + '...');
      console.log(chalk.gray('Created:'), new Date(auth.createdAt).toLocaleString());
    }

    if (workspaces.length > 0) {
      console.log(chalk.gray('\nAvailable workspaces:'));
      workspaces.forEach(ws => {
        const selected = selectedWorkspaces.includes(ws.id) ? chalk.green('✓') : chalk.gray('○');
        console.log(`  ${selected} ${ws.name} (${ws.id})`);
      });
    }

    console.log(chalk.yellow('\\nRun with --help to see available commands.'));
  }

  async resetConfig() {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure you want to reset all configuration?',
      default: false
    }]);

    if (confirm) {
      await this.config.reset();
      console.log(chalk.green('✅ Configuration reset successfully.'));
    }
  }

  async setupAuthentication() {
    console.log(chalk.yellow('🔐 Step 1: Authentication Setup\n'));

    const { setupMethod } = await inquirer.prompt([{
      type: 'list',
      name: 'setupMethod',
      message: 'How would you like to set up your Slack app?',
      choices: [
        { name: '🌐 Create new app (opens browser with pre-configured manifest)', value: 'create' },
        { name: '🔑 I already have a bot token', value: 'existing' }
      ]
    }]);

    if (setupMethod === 'create') {
      await this.createNewApp();
    }

    await this.getAndValidateToken();
  }

  async createNewApp() {
    console.log(chalk.cyan('\n📱 Creating new Slack app...'));
    
    const { method } = await inquirer.prompt([{
      type: 'list',
      name: 'method',
      message: 'How would you like to create your Slack app?',
      choices: [
        { name: '🚀 Use app manifest (automated setup)', value: 'manifest' },
        { name: '🛠️ Manual setup with guided instructions', value: 'manual' }
      ]
    }]);

    if (method === 'manifest') {
      await this.createAppWithManifest();
    } else {
      await this.createAppManually();
    }
  }

  async createAppWithManifest() {
    console.log(chalk.cyan('\n🚀 Creating app with manifest...'));
    console.log(chalk.gray('This will create a properly configured Enterprise Grid app automatically.\n'));

    const { proceed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'proceed',
      message: 'Open browser to create app with manifest?',
      default: true
    }]);

    if (proceed) {
      // Generate the manifest URL
      const manifestPath = path.join(process.cwd(), 'slack-app-manifest.json');
      const manifest = JSON.stringify({
        "display_information": {
            "name": "Slack Channel Manager"
        },
        "features": {
            "bot_user": {
                "display_name": "Slack Channel Manager",
                "always_online": false
            }
        },
        "oauth_config": {
            "redirect_urls": [
                "https://slack.com/oauth/callback"
            ],
            "scopes": {
                "bot": [
                    "channels:history",
                    "channels:read",
                    "channels:manage",
                    "groups:read",
                    "groups:write",
                    "groups:history"
                ]
            }
        },
        "settings": {
            "org_deploy_enabled": true,
            "socket_mode_enabled": false,
            "token_rotation_enabled": false
        }
      });

      const manifestUrl = encodeURIComponent(manifest);
      const createUrl = `https://api.slack.com/apps?new_app=1&manifest_json=${manifestUrl}`;
      
      await open(createUrl);
      
      console.log(chalk.yellow('\n📋 Automated Setup Instructions:'));
      console.log('1. Review the pre-configured app settings');
      console.log('2. Select your Enterprise Grid organization (NOT a workspace)');
      console.log('3. Click "Create App"');
      console.log('4. Go to "OAuth & Permissions" → Click "Install to Organization"');
      console.log('5. Authorize for your entire Enterprise Grid organization');
      console.log('6. Copy the "Bot User OAuth Token" (starts with xoxb-)');
      console.log('7. Return here and paste the token\n');

      await inquirer.prompt([{
        type: 'input',
        name: 'continue',
        message: 'Press Enter when you have your bot token ready...'
      }]);
    }
  }

  async createAppManually() {
    console.log(chalk.cyan('\n🛠️ Manual app creation...'));
    console.log(chalk.gray('I\'ll guide you through manual app creation for Enterprise Grid.\n'));

    const { proceed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'proceed',
      message: 'Open browser to create Slack app manually?',
      default: true
    }]);

    if (proceed) {
      await open('https://api.slack.com/apps?new_app=1');
      
      console.log(chalk.yellow('\n📋 Enterprise Grid App Setup Instructions:'));
      console.log('1. Click "Create New App" → "From scratch"');
      console.log('2. Enter app name: "Slack Channel Manager Enterprise"');
      console.log('3. Select any workspace in your Enterprise Grid');
      console.log('4. Click "Create App"');
      console.log('\n📋 IMPORTANT: Enable Organization Distribution:');
      console.log('\n5. Go to "OAuth & Permissions" in the sidebar');
      console.log('6. Under "Scopes" → "Bot Token Scopes", add these permissions:');
      console.log('   • channels:read');
      console.log('   • groups:read'); 
      console.log('   • channels:history');
      console.log('   • groups:history');
      console.log('   • channels:manage (for archiving)');
      console.log('   • groups:write (for private channel archiving)');
      console.log('\n7. Go to "OAuth & Permissions" in the sidebar');
      console.log('8. Scroll down to "Redirect URLs":');
      console.log('   • Click "Add New Redirect URL"');
      console.log('   • Enter: https://slack.com/oauth/callback');
      console.log('   • Click "Add" then "Save URLs"');
      console.log('\n9. Go to "Manage Distribution" in the sidebar');
      console.log('10. Under "Share Your App with Other Workspaces":');
      console.log('    • Complete all 4 sections (they should show green checkmarks)');
      console.log('    • Click "Activate Public Distribution"');
      console.log('\n11. CRITICAL: Enable Organization Distribution:');
      console.log('    • Look for "Distribute to workspaces in your organization"');
      console.log('    • Click "Enable Organization Distribution"');
      console.log('    • This may require Org Admin approval');
      console.log('\n12. Return to "OAuth & Permissions"');
      console.log('13. You should now see "Install to Organization" button');
      console.log('14. Click "Install to Organization" (NOT workspace)');
      console.log('15. Authorize for your entire Enterprise Grid organization');
      console.log('16. Copy the "Bot User OAuth Token" (starts with xoxb-)');
      console.log('17. Return here and paste the token');
      console.log('\n⚠️  If you don\'t see "Install to Organization", you need Org Admin help!\n');

      await inquirer.prompt([{
        type: 'input',
        name: 'continue',
        message: 'Press Enter when you have your bot token ready...'
      }]);
    }
  }

  async getAndValidateToken() {
    while (true) {
      const { token } = await inquirer.prompt([{
        type: 'password',
        name: 'token',
        message: 'Enter your Slack bot token (xoxb-...):'
      }]);

      if (!token || !token.startsWith('xoxb-')) {
        console.log(chalk.red('❌ Invalid token format. Bot tokens must start with "xoxb-"'));
        continue;
      }

      const spinner = ora('Validating token...').start();
      this.auth.setToken(token);

      try {
        const validation = await this.auth.validateToken();
        
        if (validation.valid) {
          spinner.succeed('Token validated successfully!');
          
          this.config.setAuth(token, 'bot');
          this.config.setAppInfo({
            teamId: validation.teamId,
            teamName: validation.teamName,
            userId: validation.userId,
            botId: validation.botId,
            isEnterpriseInstall: validation.isEnterpriseInstall
          });
          
          console.log(chalk.green(`✅ Connected to: ${validation.teamName}`));
          console.log(chalk.gray(`Enterprise Grid: ${validation.isEnterpriseInstall ? 'Yes' : 'No'}`));
          
          await this.config.save();
          break;
        } else {
          spinner.fail(`Token validation failed: ${validation.error}`);
          console.log(chalk.red('Please check your token and try again.\\n'));
        }
      } catch (error) {
        spinner.fail(`Validation error: ${error.message}`);
        console.log(chalk.red('Please check your token and try again.\\n'));
      }
    }
  }

  async discoverWorkspaces() {
    console.log(chalk.yellow('\\n🔍 Step 2: Workspace Discovery\\n'));

    const spinner = ora('Discovering accessible workspaces...').start();

    try {
      const workspaces = await this.auth.discoverWorkspaces();
      spinner.succeed(`Found ${workspaces.length} workspace(s)`);

      this.config.setWorkspaces(workspaces);
      await this.config.save();

      if (workspaces.length === 1) {
        console.log(chalk.gray(`Single workspace: ${workspaces[0].name}`));
        this.config.setSelectedWorkspaces([workspaces[0].id]);
        await this.config.save();
      } else {
        console.log(chalk.green('\\n📊 Available workspaces:'));
        workspaces.forEach(ws => {
          console.log(`  • ${ws.name} (${ws.domain || ws.id})`);
        });
      }
    } catch (error) {
      spinner.fail(`Failed to discover workspaces: ${error.message}`);
      throw error;
    }
  }

  async selectWorkspaces() {
    const workspaces = this.config.getWorkspaces();
    
    if (workspaces.length <= 1) {
      return; // Already handled in discoverWorkspaces
    }

    console.log(chalk.yellow('\\n🎯 Step 3: Workspace Selection\\n'));

    const { selectedIds } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedIds',
      message: 'Select workspaces to manage:',
      choices: workspaces.map(ws => ({
        name: `${ws.name} (${ws.domain || ws.id})`,
        value: ws.id,
        checked: false
      })),
      validate: (input) => {
        if (input.length === 0) {
          return 'Please select at least one workspace.';
        }
        return true;
      }
    }]);

    this.config.setSelectedWorkspaces(selectedIds);
    await this.config.save();

    console.log(chalk.green(`✅ Selected ${selectedIds.length} workspace(s) for management.`));
  }

  async testConfiguration() {
    console.log(chalk.yellow('\\n🧪 Step 4: Testing Configuration\\n'));

    const selectedWorkspaces = this.config.getSelectedWorkspaces();
    const spinner = ora('Testing channel access...').start();

    try {
      let totalChannels = 0;

      for (const workspaceId of selectedWorkspaces) {
        const channels = await this.auth.getWorkspaceChannels(workspaceId);
        totalChannels += channels.length;
      }

      spinner.succeed(`Successfully accessed ${totalChannels} channels across ${selectedWorkspaces.length} workspace(s)`);
      console.log(chalk.green('✅ Configuration test passed!'));
    } catch (error) {
      spinner.fail(`Configuration test failed: ${error.message}`);
      console.log(chalk.red('\\n❌ There may be permission issues. Please check:'));
      console.log('  • Your app has the required scopes');
      console.log('  • Your app is installed at the organization level');
      console.log('  • Your app has been added to the selected workspaces\\n');
      throw error;
    }
  }

  async showSetupComplete() {
    console.log(chalk.green.bold('\n🎉 Setup Complete!\n'));
    console.log(chalk.gray('Your configuration has been saved to:'));
    console.log(chalk.cyan(this.config.getConfigPath()));
    
    console.log(chalk.yellow('\n📋 Next Steps:'));
    console.log('  • Run channel analysis: npm start');
    console.log('  • Run in dry-run mode: npm start --dry-run');
    console.log('  • Execute archiving: npm start --execute');
    console.log('  • View help: npm start --help');
    
    console.log(chalk.gray('\n💡 The tool defaults to dry-run mode for safety.'));
    console.log(chalk.gray('   Use --execute flag only when you\'re ready to archive channels.\n'));
  }

  async manageWorkspaces() {
    console.log(chalk.cyan('\n🏢 Workspace Management\n'));
    
    // Re-authenticate to get latest workspace list
    const auth = this.config.getAuth();
    if (!auth) {
      console.log(chalk.red('❌ No authentication found. Please run full setup first.'));
      return;
    }

    this.auth.setToken(auth.token);
    
    try {
      console.log(chalk.gray('Discovering available workspaces...'));
      const latestWorkspaces = await this.auth.discoverWorkspaces();
      
      console.log(chalk.green(`\n✅ Found ${latestWorkspaces.length} available workspaces:`));
      latestWorkspaces.forEach(ws => {
        console.log(`  • ${ws.name} (${ws.domain || ws.id})`);
      });

      // Update stored workspaces
      this.config.setWorkspaces(latestWorkspaces);
      
      // Let user select which ones to manage
      const currentSelected = this.config.getSelectedWorkspaces();
      
      const { selectedIds } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selectedIds',
        message: 'Select workspaces to manage:',
        choices: latestWorkspaces.map(ws => ({
          name: `${ws.name} (${ws.domain || ws.id})`,
          value: ws.id,
          checked: currentSelected.includes(ws.id)
        })),
        validate: (input) => {
          if (input.length === 0) {
            return 'Please select at least one workspace.';
          }
          return true;
        }
      }]);

      this.config.setSelectedWorkspaces(selectedIds);
      await this.config.save();

      console.log(chalk.green(`\n✅ Updated! Now managing ${selectedIds.length} workspace(s).`));
      
      // Show what changed
      const added = selectedIds.filter(id => !currentSelected.includes(id));
      const removed = currentSelected.filter(id => !selectedIds.includes(id));
      
      if (added.length > 0) {
        console.log(chalk.green('Added workspaces:'));
        added.forEach(id => {
          const ws = latestWorkspaces.find(w => w.id === id);
          console.log(`  + ${ws?.name || id}`);
        });
      }
      
      if (removed.length > 0) {
        console.log(chalk.yellow('Removed workspaces:'));
        removed.forEach(id => {
          const ws = latestWorkspaces.find(w => w.id === id);
          console.log(`  - ${ws?.name || id}`);
        });
      }

    } catch (error) {
      console.log(chalk.red(`\n❌ Failed to discover workspaces: ${error.message}`));
      console.log(chalk.gray('You may need to ensure the bot is properly installed at the organization level.'));
    }
  }
}

async function main() {
  try {
    const wizard = new SetupWizard();
    await wizard.run();
  } catch (error) {
    console.error(chalk.red('\\n❌ Setup failed:'), error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}