# Slack Channel Manager

Enterprise-grade Slack workspace management tool for automatically archiving inactive channels across multiple workspaces in Slack Enterprise Grid.

## Features

🚀 **Enterprise Grid Support**
- Multi-workspace management from a single tool
- Organization-level bot installation
- Workspace discovery and selection

📊 **Smart Channel Analysis**
- Multi-timeframe activity detection (30d, 60d, 90d)
- Flexible member threshold rules
- Detailed decision logic for each channel

🔒 **Safe Operations**
- Dry-run mode by default
- Configurable exclusion patterns
- Conservative approach for inaccessible channels

📈 **Rich Reporting**
- Real-time console output with progress indicators
- Structured JSON logging for analysis
- Clear reasoning for each archiving decision

## Quick Start

### Prerequisites
- Node.js 18+ 
- Slack Enterprise Grid organization
- Organization Admin permissions (for initial setup)

### Installation

1. **Clone and install:**
   ```bash
   git clone https://github.com/YOUR-USERNAME/slack-channel-manager.git
   cd slack-channel-manager
   npm install
   ```

2. **Run guided setup:**
   ```bash
   npm run setup
   ```
   This will guide you through creating and configuring your Slack app for Enterprise Grid.

3. **Test the installation:**
   ```bash
   npm start
   ```

## Enterprise Grid Setup

### Automated Setup Wizard

The setup wizard guides you through the entire process:

```bash
npm run setup
```

Choose "Create new app" for first-time setup. The wizard will:
- Open your browser to create a Slack app
- Provide step-by-step instructions for Enterprise Grid configuration
- Handle authentication and workspace discovery
- Save your configuration securely

### Manual Setup Guide

For detailed manual setup instructions with screenshots, see: [docs/setup-guide.md](docs/setup-guide.md)

## Usage

### Basic Commands

```bash
# Dry-run analysis (safe, default mode)
npm start

# Execute archiving with custom rules
npm start -- --execute --max-members-inactive 5 --inactive-days 60

# Target specific workspace
npm start -- --workspace "workspace-name"

# View help
npm start -- --help
```

### Archiving Rules

The tool uses flexible, tiered archiving rules:

1. **Rule 1:** Channels with ≤0 members + inactive for X days
2. **Rule 2:** Channels with ≤N members + inactive for 60+ days  
3. **Rule 3:** Channels with ≤N members + inactive for 90+ days

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `--dry-run` | `true` | Safe mode - shows what would be archived |
| `--execute` | `false` | Actually perform archiving operations |
| `--inactive-days` | `30` | Primary inactivity threshold |
| `--min-members` | `0` | Immediate archiving threshold |
| `--max-members-inactive` | `10` | Max members for inactivity-based archiving |
| `--workspace` | all | Target specific workspace |

### Example Output

```
🚀 Enterprise Channel Manager

Mode: DRY RUN
Archive Rules:
  • Zero members + inactive 30+ days
  • ≤10 members + inactive 60+ days
  • ≤10 members + inactive 90+ days

📊 Processing workspace: Engineering

  🔍 Analyzing: old-project-alpha
    📊 Members: 2
    🔒 Type: Public
    ⏰ Last message: 75 days ago
    📈 Activity timeline:
       • 30d: Inactive
       • 60d: Inactive
       • 90d: Active
    🚫 Excluded: No
    📝 Decision logic:
       Rule 1: Members ≤ 0 + Inactive 30d: ✗
       Rule 2: Members ≤ 10 + Inactive 60d: ✓
       Rule 3: Members ≤ 10 + Inactive 90d: ✗
       → Archive: Rule 2 triggered
    🗃️  WILL ARCHIVE - ≤10 members and inactive 60+ days
```

## Configuration Management

### View Current Setup
```bash
npm run setup
# Choose "View current configuration"
```

### Add/Remove Workspaces
```bash
npm run setup  
# Choose "Add/remove workspaces"
```

### Reset Configuration
```bash
npm run setup
# Choose "Reset all configuration"
```

## Security

- 🔐 **No secrets in code** - All tokens stored locally in `.slack-config/`
- 🛡️ **Gitignore protection** - Sensitive files automatically excluded
- 🔒 **Local storage only** - Configuration never leaves your machine
- ✅ **Audit trail** - All operations logged with structured data

## Development

### Project Structure
```
slack-channel-manager/
├── src/
│   ├── index.js          # Main application
│   ├── setup.js          # Setup wizard
│   ├── auth.js           # Slack authentication
│   └── config.js         # Configuration management
├── docs/
│   ├── setup-guide.md    # Detailed setup guide
│   └── screenshots/      # Setup process screenshots
└── .slack-config/        # Local configuration (gitignored)
```

### Logging

All operations are logged with structured JSON:

```bash
# View logs
tail -f slack-channel-manager.log

# Pretty print logs (if you have jq)
cat slack-channel-manager.log | jq '.'
```

## Troubleshooting

### Common Issues

**"No configuration found"**
```bash
npm run setup  # Run the setup wizard
```

**"Invalid client_id parameter"**
- Ensure app is installed at organization level (not workspace level)
- Check redirect URL is set to `https://slack.com/oauth/callback`

**"not_in_channel" warnings**
- Normal for private channels where bot isn't a member
- Tool uses conservative archiving rules for inaccessible channels

**Bot can't access channel history**
- Add bot to channels for better analysis, or
- Use `--join-channels` flag to attempt auto-joining public channels

### Debug Mode

```bash
DEBUG=true npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Test thoroughly with `--dry-run`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 📖 [Setup Guide with Screenshots](docs/setup-guide.md)
- 🐛 [Report Issues](https://github.com/YOUR-USERNAME/slack-channel-manager/issues)
- 💡 [Feature Requests](https://github.com/YOUR-USERNAME/slack-channel-manager/issues)