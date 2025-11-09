# Machinor Roundtable

A SillyTavern extension that seamlessly injects AI-customized plot context into your roleplay chats, guiding the model to generate responses with deeper context and ulterior plans.

## Features

- **Real-time AI Customization**: Uses your current LLM to generate plot context tailored to your characters and scenario
- **Customizable Frequency**: Control how often plot injections occur (in number of exchanges)
- **Universal Templates**: Works with any roleplay genre or tone - the AI adapts to your style
- **Manual Control**: Trigger plot injection on-demand with a single click
- **Debug Mode**: See exactly what's being injected for development and fine-tuning
- **Seamless Integration**: Invisible during normal roleplay, maintains immersion

## Installation

1. Copy the `machinor-roundtable` folder to `public/scripts/extensions/third-party/`
2. Restart SillyTavern
3. Go to Extensions settings (right panel)
4. Look for "Machinor Roundtable" and configure your preferences

## Usage

### Basic Setup
1. **Enable the extension** using the toggle switch
2. **Set injection frequency** - how many exchanges between plot injections (default: 7)
3. **Start roleplaying** - the extension works automatically in the background

### Manual Control
- Click **"Inject Plot Now"** to manually trigger a plot injection
- Use **Debug Mode** to see injected messages (visible only to you)

### Customization
- Adjust **injection frequency** based on your pacing preferences
- Lower numbers = more frequent plot injections
- Higher numbers = more subtle, less frequent intervention

## How It Works

The extension analyzes your character's personality, description, and scenario, then uses your current LLM to generate plot context that guides the model toward deeper, more engaging responses. This happens invisibly before your latest message, so the model has additional context without breaking immersion.

## Settings

- **Enable Plot Progression**: Master on/off switch for the extension
- **Injection Frequency**: Number of exchanges between plot injections (1-50)
- **Debug Mode**: Show injected messages for development/testing
- **Inject Plot Now**: Manual trigger for immediate plot injection

## Technical Details

- **Local Processing**: All generation happens locally using your configured LLM
- **Caching**: Generated plot contexts are cached to minimize latency
- **Smart Timing**: Injects during conversational lulls, not intense moments
- **Character Focus**: Prioritizes personality, description, and scenario fields

## Development Status

This is Stage 1 (Foundation) of the extension. Current features:
- ✅ Basic extension structure
- ✅ UI panel with frequency control
- ✅ Settings persistence
- ✅ Manual trigger button
- ✅ Debug mode toggle

Upcoming features:
- AI customization engine
- Automatic injection based on frequency
- Character field analysis
- Chat history monitoring
- Template system
- World info integration

## Troubleshooting

**Extension doesn't appear in settings:**
- Check that the folder is in `public/scripts/extensions/third-party/machinor-roundtable`
- Verify all files are present (manifest.json, index.js, settings.html, style.css)
- Check browser console (F12) for errors
- Ensure the folder name matches exactly: "machinor-roundtable"

**Settings not saving:**
- Check browser console for errors
- Verify `saveSettingsDebounced()` is available
- Ensure extension name matches folder name exactly

## Contributing

This extension follows SillyTavern's extension development best practices. For issues or feature requests, please visit the GitHub repository.

## License

MIT License - feel free to modify and distribute